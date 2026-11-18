import { exec, appHome, readTextFile } from "herdr";
import { URL_RE, parse, startLinks, branchState, branchName } from "./links.js";
import { bin } from "./lib/shared.js";

const USER_MESSAGE = '"message":{"role":"user","content":"';

// The first plain user message is the task. Null until the transcript has one.
export async function readStart(path) {
  const result = await exec("grep", ["-m", "20", "-F", USER_MESSAGE, path]);
  for (const line of result.stdout.split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isMeta || typeof entry.message?.content !== "string") continue;
    return startLinks(entry.message.content);
  }
  return null;
}

// A size below `offset` means the file was rewritten.
export async function scanFrom(path, offset) {
  const result = await exec(bin("lasso-links-since"), [path, String(offset), URL_RE]);
  const [size, ...urls] = result.stdout.trim().split("\n");
  return { size: Number(size), links: urls.map(parse).filter(Boolean) };
}

export async function readBranch(cwd) {
  const result = await exec(bin("lasso-branch-state"), [cwd]).catch(() => null);
  if (result?.code !== 0) return null;
  const out = result.stdout.trim();
  return { branch: branchName(out.split("\n")[0]), line: branchState(out) };
}

const ISSUE = "identifier title url state { name type color }";
const ISSUE_FIELDS = `${ISSUE} parent { ${ISSUE} } project { name url } attachments { nodes { url } }
  relations { nodes { type relatedIssue { ${ISSUE} } } } inverseRelations { nodes { type issue { ${ISSUE} } } }
  children { nodes { state { type } } }`;

let linearKey;
async function readLinearKey() {
  const fromEnv = (await exec("printenv", ["LINEAR_API_KEY"]).catch(() => null))?.stdout.trim();
  return fromEnv || (await readTextFile(`${appHome()}/linear-key`).catch(() => "")).trim();
}

// In the order of `ids`, null for an ID Linear doesn't know. Null when there is no key or no network.
export async function fetchIssues(ids) {
  linearKey ??= await readLinearKey();
  if (!linearKey) return null;
  const query = `{ ${ids.map((id, i) => `i${i}: issue(id: "${id}") { ${ISSUE_FIELDS} }`).join(" ")} }`;
  try {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: linearKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = (await response.json()).data ?? {};
    return ids.map((_, i) => data[`i${i}`] ?? null);
  } catch {
    return null;
  }
}

const prFields = (
  number,
) => `url title state isDraft reviewDecision mergeable baseRefName autoMergeRequest { enabledAt } mergedAt author { login }
  mergeCommit { checkSuites(first: 30) { nodes { status conclusion workflowRun { url event workflow { name } } } } }
  labels(first: 20) { nodes { name color } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  latestReviews(first: 10) { nodes { state url author { login } } }
  reviewThreads(first: 100) { nodes { isResolved comments(last: 1) { nodes { url author { login } } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename
    ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: ${number}) }
    ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${number}) } } } } } } }`;

// In the order of `links`, null when gh failed or the PR is unknown.
export async function fetchPrs(links) {
  // Safe to interpolate: URL_RE allows only letters, digits, "_", "." and "-" in owner and repo.
  const query = `{ ${links
    .map((link, i) => {
      const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)\/pull/.exec(link.url);
      return `p${i}: repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${link.number}) { ${prFields(link.number)} } }`;
    })
    .join(" ")} }`;
  const result = await exec("gh", ["api", "graphql", "-f", `query=${query}`]).catch(() => null);
  let data = {};
  try {
    data = JSON.parse(result?.stdout ?? "").data ?? {};
  } catch {}
  return links.map((_, i) => data[`p${i}`]?.pullRequest ?? null);
}
