// Links in transcript text: what each URL is, and the links of an agent's task.
// No Herdr imports, so `node links.check.mjs` can test it.

export const URL_RE = String.raw`https://(linear\.app/[a-z0-9-]+/(issue|project|document)/[A-Za-z0-9-]+|github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+|[a-z0-9-]+\.slack\.com/archives/[A-Z0-9]+/p[0-9]+)`;
export function parse(url) {
  let m;
  if ((m = /^(https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z]+-\d+))/.exec(url))) return { kind: "issue", key: m[2].toUpperCase(), url: m[1] };
  if ((m = /linear\.app\/[^/]+\/(?:project|document)\/(.+)$/.exec(url))) {
    const name = m[1].replace(/-[0-9a-f]{8,}$/, "").replace(/-/g, " ");
    return { kind: "doc", key: url, url, title: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  if ((m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url))) return { kind: "pr", key: `${m[1]}/${m[2]}#${m[3]}`.toLowerCase(), url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`, repo: m[2], number: +m[3] };
  if ((m = /\/archives\/[A-Z0-9]+\/p(\d{10})\d{6}/.exec(url))) return { kind: "slack", key: url, url, at: +m[1] * 1000 };
  return null;
}

// The task's links: its URLs, then bare ticket IDs (uppercase only: "THU-4601", not "utf-8").
export function startLinks(prompt) {
  const out = new Map();
  for (const u of prompt.match(new RegExp(URL_RE, "g")) ?? []) { const l = parse(u); if (l && !out.has(l.key)) out.set(l.key, l); }
  for (const id of prompt.match(/\b[A-Z]{2,6}-\d+\b/g) ?? []) if (!out.has(id)) out.set(id, { kind: "issue", key: id, url: null });
  return [...out.values()];
}

// What still blocks an open PR, from GitHub's GraphQL answer (prFields() in main.js), as lines
// for the card: [{ text, tone: "bad" | "good" | "dim" }]. Nothing for a merged or closed PR.
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
export function readiness(p) {
  if (!p || p.state !== "OPEN") return [];
  const out = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!p.isDraft) {
    if (p.reviewDecision === "CHANGES_REQUESTED") {
      const who = (p.latestReviews?.nodes ?? []).filter((r) => r.state === "CHANGES_REQUESTED").map((r) => r.author?.login).filter(Boolean);
      out.push({ text: `Changes requested${who.length ? ` by ${who.join(", ")}` : ""}`, tone: "bad" });
    } else if (p.reviewDecision === "APPROVED") out.push({ text: "Approved", tone: "good" });
    else if (p.reviewDecision === "REVIEW_REQUIRED") {
      const who = (p.reviewRequests?.nodes ?? []).map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name).filter(Boolean);
      out.push({ text: `Needs review${who.length ? ` · ${who.join(", ")}` : ""}`, tone: "dim" });
    }
  }
  // Checks have their own section: checkList().
  const open = (p.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).length;
  if (open) out.push({ text: `${plural(open, "unresolved comment")}`, tone: "bad" });
  if (p.mergeable === "CONFLICTING") out.push({ text: `Conflicts with ${p.baseRefName}`, tone: "bad" });
  if (p.autoMergeRequest) out.push({ text: "Auto-merge on", tone: "dim" });
  return out;
}

// The branch line from BRANCH in main.js: the status header ("## a...origin/a [ahead 2]"), the
// uncommitted count, the base ("origin/master"), behind and ahead of the base. Empty when clean.
export function branchState(out) {
  const [head = "", dirty = "0", base = "", behind = "0", ahead = "0"] = out.split("\n");
  // With an upstream, "ahead" in the header; without one, every commit past the base is unpushed.
  const unpushed = /\.\.\.\S+/.test(head) ? +(/ahead (\d+)/.exec(head)?.[1] ?? 0) : +ahead || 0;
  const parts = [];
  if (unpushed) parts.push(`${unpushed} not pushed`);
  if (+behind) parts.push(`${behind} behind ${base.replace(/^origin\//, "")}`);
  if (+dirty) parts.push(`${dirty} uncommitted`);
  return parts.join(" · ");
}

// From a Linear issue (with relations, inverseRelations and children): the issues that block
// it and that it blocks, and how many sub-issues are done.
const DONE = new Set(["completed", "canceled"]);
export function linearLinks(issue) {
  const one = (i, blocked) => ({ blocked, key: i.identifier, title: i.title, url: i.url, state: i.state, done: DONE.has(i.state?.type) });
  const blocks = [
    ...(issue?.inverseRelations?.nodes ?? []).filter((r) => r.type === "blocks").map((r) => one(r.issue, true)),
    ...(issue?.relations?.nodes ?? []).filter((r) => r.type === "blocks").map((r) => one(r.relatedIssue, false)),
  ];
  const kids = issue?.children?.nodes ?? [];
  return { blocks, subs: kids.length ? { done: kids.filter((k) => DONE.has(k.state?.type)).length, total: kids.length } : null };
}

// Every check of the PR's last commit, worst first: [{ name, state, required, url, count }].
// state: "failed" | "running" | "cancelled" | "passed" | "skipped". The same name with the same
// state is one row with a count (the skipped "claude" runs on each commit).
const ORDER = ["failed", "running", "cancelled", "passed", "skipped"];
function checkState(c) {
  if (c.__typename === "StatusContext" || c.context) return c.state === "SUCCESS" ? "passed" : FAILED.has(c.state) ? "failed" : "running";
  if (c.status && c.status !== "COMPLETED") return "running";
  if (c.conclusion === "SUCCESS") return "passed";
  if (FAILED.has(c.conclusion)) return "failed";
  if (c.conclusion === "CANCELLED") return "cancelled";
  return "skipped"; // SKIPPED, NEUTRAL, STALE
}
export function checkList(p) {
  const rows = new Map();
  for (const c of p?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []) {
    const name = c.name ?? c.context, state = checkState(c), key = `${name}\0${state}`;
    const row = rows.get(key);
    if (row) { row.count++; row.required ||= Boolean(c.isRequired); }
    else rows.set(key, { name, state, required: Boolean(c.isRequired), url: c.detailsUrl ?? c.targetUrl ?? null, count: 1 });
  }
  return [...rows.values()].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.required - a.required || a.name.localeCompare(b.name));
}

export const DEFAULT_BRANCHES = new Set(["", "master", "main", "develop"]);
// The branch from a `git status -b` header: "## a...origin/a [ahead 2]", "## a",
// "## No commits yet on a". Detached ("## HEAD (no branch)"): "".
export function branchName(head) {
  const m = /^## (?:No commits yet on )?(.+?)(?:\.\.\.| \[|$)/.exec(head ?? "");
  return !m || m[1].startsWith("HEAD (no branch)") ? "" : m[1];
}

// CI after the merge: the merge commit's Release and Deploy runs (GitHub Actions, pushed), as
// lines for a merged PR: "Releasing", "Deploying", "Deployed", "Deploy failed".
const RUN_FAILED = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
export function deployState(g) {
  const runs = (g?.mergeCommit?.checkSuites?.nodes ?? []).filter((s) => s.workflowRun?.event === "push");
  const one = (name) => {
    const s = runs.find((x) => x.workflowRun.workflow?.name === name);
    if (!s) return null;
    if (s.status !== "COMPLETED") return "running";
    return s.conclusion === "SUCCESS" ? "done" : RUN_FAILED.has(s.conclusion) ? "failed" : null;
  };
  return { release: one("Release"), deploy: one("Deploy") };
}
export function afterMerge(g) {
  if (g?.state !== "MERGED") return [];
  const { release, deploy } = deployState(g);
  if (release === "failed") return [{ text: "Release failed", tone: "bad" }];
  if (deploy === "failed") return [{ text: "Deploy failed", tone: "bad" }];
  if (deploy === "done") return [{ text: "Deployed", tone: "good" }];
  if (deploy === "running") return [{ text: "Deploying", tone: "dim" }];
  if (release === "running") return [{ text: "Releasing", tone: "dim" }];
  if (release === "done") return [{ text: "Released", tone: "dim" }];
  return [];
}
// Nothing more will change after the merge: deployed, failed, or no runs 30 minutes on.
export function deployFinal(g, now = Date.now()) {
  const { release, deploy } = deployState(g);
  if (deploy === "done" || deploy === "failed" || release === "failed") return true;
  return !release && !deploy && now - Date.parse(g?.mergedAt ?? 0) > 30 * 60000;
}

// An open PR on another PR's branch: "Stacked on #457", or once #457 is merged, a warning to
// rebase. `yours`: the tasks mod's PR list ({ number, repo, branch, merged }).
export function stackLine(g, yours, repo) {
  const base = g?.baseRefName;
  if (g?.state !== "OPEN" || DEFAULT_BRANCHES.has(base ?? "")) return null;
  const on = yours.filter((p) => p.repo === repo && p.branch === base);
  const p = on.find((x) => !x.merged) ?? on[0];
  if (!p) return { text: `Stacked on ${base}`, tone: "dim" };
  return p.merged ? { text: `Base #${p.number} is merged: rebase`, tone: "bad", mergedBase: p.number } : { text: `Stacked on #${p.number}`, tone: "dim" };
}

// The one answer at the top of the card: what this work needs next, from the PR (g, its
// GitHub data), its stack line, the issue's blockers and Linear state. null: nothing to say.
// tone: "bad" (you must act), "warn" (blocked or not posted), "dim" (waiting), "good".
export function nextStep({ g, stack, blocks = [], issueState }) {
  const blocker = blocks.find((b) => b.blocked && !b.done);
  const blocked = blocker && { text: `Blocked by ${blocker.key}`, tone: "warn" };
  if (!g) return blocked ?? null;
  if (g.state === "MERGED") {
    const [after] = afterMerge(g), where = issueState ? ` · ${issueState}` : "";
    if (after?.tone === "bad") return after;
    if (after?.text === "Deployed") return { text: `Deployed${where}`, tone: "good" };
    return { text: `Merged · ${after ? after.text.toLowerCase() : issueState ?? "done"}`, tone: "dim" };
  }
  if (g.state === "CLOSED") return { text: "PR closed without merge", tone: "dim" };
  if (stack?.mergedBase) return { text: `Next: rebase, base #${stack.mergedBase} is merged`, tone: "bad" };
  const checks = checkList(g), failed = checks.filter((c) => c.state === "failed" && c.required);
  if (failed.length) return { text: `Next: fix ${failed[0].name}${failed.length > 1 ? ` and ${failed.length - 1} more` : ""}`, tone: "bad" };
  if (g.mergeable === "CONFLICTING") return { text: `Next: resolve conflicts with ${g.baseRefName}`, tone: "bad" };
  const lines = readiness(g), say = (start) => lines.find((l) => l.text.startsWith(start))?.text;
  const changes = say("Changes requested");
  if (changes) return { text: `Next: address the c${changes.slice(1)}`, tone: "bad" };
  const threads = say("1 unresolved") ?? lines.find((l) => /^\d+ unresolved/.test(l.text))?.text;
  if (threads) return { text: `Next: answer ${threads.replace(" unresolved", " open review")}`, tone: "bad" };
  if (blocked) return blocked;
  if (g.isDraft) return { text: "Draft: mark it ready when done", tone: "dim" };
  if (!(g.labels?.nodes ?? []).some((l) => l.name === "ready-for-review")) return { text: "Not posted for review", tone: "warn" };
  if (checks.some((c) => c.required && c.state === "running")) return { text: "Waiting for checks", tone: "dim" };
  const review = say("Needs review");
  if (review) return { text: review.replace("Needs review", "Waiting for review"), tone: "dim" };
  if (g.reviewDecision === "APPROVED") return g.autoMergeRequest ? { text: "Merges by itself", tone: "good" } : { text: "Ready to merge", tone: "good" };
  return null;
}
