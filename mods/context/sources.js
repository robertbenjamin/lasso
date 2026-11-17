// What the Context panel reads from outside: the agent's Claude transcript, its git folder,
// Linear and GitHub. No state here: main.js keeps the results and decides when to read again.
import { exec, appHome, readTextFile } from "herdr";
import { URL_RE, parse, startLinks, branchState, branchName } from "./links.js";

// The first prompts with plain text: the first one that isn't a system note is the task.
const FIRST = `grep -m 20 -F '"message":{"role":"user","content":"' "$1"`;
// The task's links (startLinks()); null while the transcript has no prompt yet.
export async function readStart(path) {
  const r = await exec("sh", ["-c", FIRST, "sh", path]);
  for (const line of r.stdout.split("\n")) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.isMeta || typeof d.message?.content !== "string") continue;
    return startLinks(d.message.content);
  }
  return null;
}

// The links after byte $2 of transcript $1, size first. Only your typed prompts and the agent's
// messages: tool output and the CLAUDE.md attachment hold links of other work.
// ponytail: a line that is half written when we read it loses its links; rescan if that shows.
const SCAN = `size=$(wc -c < "$1" | tr -d ' '); echo "$size"
[ "$size" -gt "$2" ] || exit 0
tail -c +$(($2 + 1)) "$1" | head -c $((size - $2)) | grep -F -e '"message":{"role":"user","content":"' -e '"type":"assistant"' | grep -oE '${URL_RE}'`;
// { size, links } written after byte `off`. A size below `off`: the file was written again.
export async function scanFrom(path, off) {
  const r = await exec("sh", ["-c", SCAN, "sh", path, String(off)]);
  const [size, ...urls] = r.stdout.trim().split("\n");
  return { size: +size, links: urls.map(parse).filter(Boolean) };
}

// For branchName() and branchState(): the status header, the uncommitted count, the base, and
// how far behind and ahead of it. Reads only, as the Changes panel (no index refresh, no lock).
// ponytail: no fetch, so "behind" is as fresh as the last fetch in that folder.
const BRANCH = `cd "$1" || exit 1
G() { git --no-optional-locks -c core.fsmonitor=false "$@"; }
s=$(G status --porcelain=v1 -b) || exit 1
printf '%s\\n' "$s" | head -1
printf '%s\\n' "$s" | tail -n +2 | grep -c .
base=$(G rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/master); echo "$base"
G rev-list --count "HEAD..$base" 2>/dev/null || echo 0
G rev-list --count "$base..HEAD" 2>/dev/null || echo 0`;
// { branch, line } of the folder; null when it isn't a git folder.
export async function readBranch(cwd) {
  const r = await exec("sh", ["-c", BRANCH, "sh", cwd]).catch(() => null);
  if (r?.code !== 0) return null;
  const out = r.stdout.trim();
  return { branch: branchName(out.split("\n")[0]), line: branchState(out) };
}

// Each issue with what the card shows: state, parent, project, attachments (PRs and Slack
// threads), blockers (linearLinks()) and sub-issues.
const ISSUE = "identifier title url state { name type color }";
const ISSUE_FIELDS = `${ISSUE} parent { ${ISSUE} } project { name url } attachments { nodes { url } }
  relations { nodes { type relatedIssue { ${ISSUE} } } } inverseRelations { nodes { type issue { ${ISSUE} } } }
  children { nodes { state { type } } }`;
let linearKey;
// The issues for `ids` in one call, in the same order (null for an ID Linear doesn't know).
// null for all of them: no key, or offline.
export async function fetchIssues(ids) {
  linearKey ??= (await readTextFile(`${appHome()}/linear-key`).catch(() => "")).trim();
  if (!linearKey) return null;
  const query = `{ ${ids.map((id, i) => `i${i}: issue(id: "${id}") { ${ISSUE_FIELDS} }`).join(" ")} }`;
  try {
    const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: linearKey, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const data = (await r.json()).data ?? {};
    return ids.map((_, i) => data[`i${i}`] ?? null);
  } catch { return null; }
}

// What readiness(), checkList(), the label chips, stackLine() and afterMerge() read, for PR n.
const prFields = (n) => `url title state isDraft reviewDecision mergeable baseRefName autoMergeRequest { enabledAt } mergedAt author { login }
  mergeCommit { checkSuites(first: 30) { nodes { status conclusion workflowRun { url event workflow { name } } } } }
  labels(first: 20) { nodes { name color } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  latestReviews(first: 10) { nodes { state url author { login } } }
  reviewThreads(first: 100) { nodes { isResolved comments(last: 1) { nodes { url author { login } } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename
    ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: ${n}) }
    ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${n}) } } } } } } }`;
// The PRs' GitHub data in one call (about 0.5 s, whatever the query), in the same order
// (null when gh failed or GitHub doesn't know the PR).
export async function fetchPrs(links) {
  // Owner and repo come from URL_RE: only letters, digits, "_", "." and "-".
  const query = `{ ${links.map((l, i) => {
    const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)\/pull/.exec(l.url);
    return `p${i}: repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${l.number}) { ${prFields(l.number)} } }`;
  }).join(" ")} }`;
  const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`]).catch(() => null);
  let data = {};
  try { data = JSON.parse(r?.stdout ?? "").data ?? {}; } catch { /* gh failed: the chips from task.prs stay */ }
  return links.map((_, i) => data[`p${i}`]?.pullRequest ?? null);
}
