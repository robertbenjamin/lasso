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

// The task's links: its URLs, then bare ticket IDs (uppercase only: "ABC-4601", not "utf-8").
export function startLinks(prompt) {
  const out = new Map();
  for (const u of prompt.match(new RegExp(URL_RE, "g")) ?? []) { const l = parse(u); if (l && !out.has(l.key)) out.set(l.key, l); }
  for (const id of prompt.match(/\b[A-Z]{2,6}-\d+\b/g) ?? []) if (!out.has(id)) out.set(id, { kind: "issue", key: id, url: null });
  return [...out.values()];
}

// The review facts of a PR (GitHub's GraphQL answer, prFields() in sources.js), shared by
// readiness() and nextStep(). An open thread whose last comment is from the PR's author is
// answered: it waits for "Resolve", which the ruleset needs before the merge.
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// GitHub's page to resolve conflicts in the browser.
const conflictsUrl = (p) => (p?.url ? `${p.url}/conflicts` : null);
export function reviewFacts(p) {
  const author = p?.author?.login;
  const open = (p?.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved);
  const last = (t) => t.comments?.nodes?.[0];
  const answered = open.filter((t) => author && last(t)?.author?.login === author);
  const toAnswer = open.filter((t) => !answered.includes(t));
  const changes = (p?.latestReviews?.nodes ?? []).filter((r) => r.state === "CHANGES_REQUESTED");
  return {
    toAnswer: toAnswer.length,
    answered: answered.length,
    // The exact spots: the first thread of each kind, the first review that asks for changes.
    answerUrl: last(toAnswer[0] ?? {})?.url ?? null,
    resolveUrl: last(answered[0] ?? {})?.url ?? null,
    changesUrl: changes[0]?.url ?? null,
    changesBy: changes.map((r) => r.author?.login).filter(Boolean),
    reviewers: (p?.reviewRequests?.nodes ?? []).map((r) => r.requestedReviewer?.login ?? r.requestedReviewer?.name).filter(Boolean),
  };
}

// What still blocks an open PR, as lines for the card: [{ text, tone, url }], tone "act" (you
// can do something), "dim" (waiting, or a fact) or "good"; url: the exact spot to open, if any.
// Nothing for a merged or closed PR.
export function readiness(p) {
  if (!p || p.state !== "OPEN") return [];
  const out = [], f = reviewFacts(p), by = (who) => (who.length ? ` · ${who.join(", ")}` : "");
  if (!p.isDraft) {
    if (p.reviewDecision === "CHANGES_REQUESTED") out.push({ text: `Changes requested${by(f.changesBy).replace(" · ", " by ")}`, tone: "act", url: f.changesUrl });
    else if (p.reviewDecision === "APPROVED") out.push({ text: "Approved", tone: "good" });
    else if (p.reviewDecision === "REVIEW_REQUIRED") out.push({ text: `Needs review${by(f.reviewers)}`, tone: "dim" });
  }
  // Checks have their own section: checkList().
  if (f.toAnswer) out.push({ text: `${plural(f.toAnswer, "review comment")} to answer`, tone: "act", url: f.answerUrl });
  if (f.answered) out.push({ text: `${plural(f.answered, "answered comment")} to resolve`, tone: "act", url: f.resolveUrl });
  if (p.mergeable === "CONFLICTING") out.push({ text: `Conflicts with ${p.baseRefName}`, tone: "act", url: conflictsUrl(p) });
  if (p.autoMergeRequest) out.push({ text: "Auto-merge on", tone: "dim" });
  return out;
}

// The branch line from BRANCH in sources.js: the status header ("## a...origin/a [ahead 2]"), the
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
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
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
  const find = (name) => runs.find((x) => x.workflowRun.workflow?.name === name);
  const one = (name) => {
    const s = find(name);
    if (!s) return null;
    if (s.status !== "COMPLETED") return "running";
    return s.conclusion === "SUCCESS" ? "done" : RUN_FAILED.has(s.conclusion) ? "failed" : null;
  };
  return { release: one("Release"), deploy: one("Deploy"), urls: { release: find("Release")?.workflowRun.url ?? null, deploy: find("Deploy")?.workflowRun.url ?? null } };
}
export function afterMerge(g) {
  if (g?.state !== "MERGED") return [];
  const { release, deploy, urls } = deployState(g);
  if (release === "failed") return [{ text: "Release failed", tone: "act", url: urls.release }];
  if (deploy === "failed") return [{ text: "Deploy failed", tone: "act", url: urls.deploy }];
  if (deploy === "done") return [{ text: "Deployed", tone: "good", url: urls.deploy }];
  if (deploy === "running") return [{ text: "Deploying", tone: "dim", url: urls.deploy }];
  if (release === "running") return [{ text: "Releasing", tone: "dim", url: urls.release }];
  if (release === "done") return [{ text: "Released", tone: "dim", url: urls.release }];
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
  // base: the PR it is stacked on (null when it isn't yours), baseName: its branch.
  if (!p) return { text: `Stacked on ${base}`, tone: "dim", base: null, baseName: base };
  return p.merged ? { text: `Base #${p.number} is merged: rebase`, tone: "act", mergedBase: p.number, base: p, baseName: base }
    : { text: `Stacked on #${p.number}`, tone: "dim", base: p, baseName: base };
}

// The one answer at the top of the card: what this work needs next, from the PR (g, its GitHub
// data), its stack line, the issue's blockers and Linear state. The first rule that holds wins:
// first what you can do now, then what you wait for. url: the exact spot to open. null: nothing
// to say.
// tone: "act" (your turn), "dim" (you wait: for review, checks or another ticket), "good" (merged).
// reviewLabel: the label that asks for review (reviewLabel in lasso.json); none: no such step.
export function nextStep({ g, stack, blocks = [], issueState, reviewLabel }) {
  const blocker = blocks.find((b) => b.blocked && !b.done);
  const blocked = blocker && { text: `Blocked by ${blocker.key}`, tone: "dim", url: blocker.url ?? null }; // you wait for another ticket
  if (!g) return blocked ?? null;
  const say = (text, tone, url = g.url ?? null) => ({ text, tone, url });
  if (g.state === "MERGED") {
    const [after] = afterMerge(g);
    if (after?.tone === "act") return after; // Release or Deploy failed: opens that run
    if (after?.text === "Deployed") return say(`Deployed${issueState ? ` · ${issueState}` : ""}`, "good", after.url);
    return say(`Merged · ${after ? after.text.toLowerCase() : issueState ?? "done"}`, "good", after?.url ?? g.url); // your part is done
  }
  if (g.state === "CLOSED") return say("PR closed without merge", "dim");
  const act = (text, url) => say(`Next: ${text}`, "act", url ?? g.url ?? null);
  // Someone put a hold on it: nothing else matters until the label goes.
  if ((g.labels?.nodes ?? []).some((l) => /^do[ -]not[ -]merge$/i.test(l.name))) return say("On hold: do not merge", "dim");
  if (stack?.mergedBase) return act(`rebase, base #${stack.mergedBase} is merged`);
  const checks = checkList(g), failed = checks.filter((c) => c.state === "failed" && c.required);
  if (failed.length) return act(`fix ${failed[0].name}${failed.length > 1 ? ` and ${failed.length - 1} more` : ""}`, failed[0].url);
  if (g.mergeable === "CONFLICTING") return act(`resolve conflicts with ${g.baseRefName}`, conflictsUrl(g));
  const f = reviewFacts(g);
  if (g.reviewDecision === "CHANGES_REQUESTED") return act(`address the changes requested${f.changesBy.length ? ` by ${f.changesBy.join(", ")}` : ""}`, f.changesUrl);
  if (f.toAnswer) return act(`answer ${plural(f.toAnswer, "review comment")}`, f.answerUrl);
  if (blocked) return blocked;
  if (g.isDraft) return say("Draft: mark it ready when done", "dim");
  if (reviewLabel && !(g.labels?.nodes ?? []).some((l) => l.name === reviewLabel)) return act(`post for review (${reviewLabel})`);
  if (f.answered) return act(`resolve ${plural(f.answered, "answered comment")}`, f.resolveUrl);
  if (checks.some((c) => c.required && c.state === "running")) return say("Waiting for checks", "dim", g.url ? `${g.url}/checks` : null);
  if (g.reviewDecision === "REVIEW_REQUIRED") return say(`Waiting for review${f.reviewers.length ? ` · ${f.reviewers.join(", ")}` : ""}`, "dim");
  if (g.reviewDecision === "APPROVED") return g.autoMergeRequest ? say("Merges by itself", "good") : say("Ready to merge", "good");
  return null;
}
