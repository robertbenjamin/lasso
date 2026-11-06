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

// What still blocks an open PR, from GitHub's GraphQL answer (PR_FIELDS in main.js), as lines
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
  const rollup = p.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const failing = [...new Set((rollup?.contexts?.nodes ?? []).filter((c) => FAILED.has(c.conclusion ?? c.state)).map((c) => c.name ?? c.context))];
  if (failing.length) out.push({ text: `${plural(failing.length, "check")} failing: ${failing.join(", ")}`, tone: "bad" });
  else if (rollup?.state === "PENDING") out.push({ text: "Checks running", tone: "dim" });
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
