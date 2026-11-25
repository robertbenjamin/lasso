// No Herdr imports here (shared.js is stubbed in tests), so node can test it.
import { isFeatureBranch, STEPS } from "./lib/shared.js";

export const URL_RE = String.raw`https://(linear\.app/[a-z0-9-]+/(issue|project|document)/[A-Za-z0-9-]+|github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+|[a-z0-9-]+\.slack\.com/archives/[A-Z0-9]+/p[0-9]+)`;
export function parse(url) {
  let match;
  if ((match = /^(https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z]+-\d+))/.exec(url)))
    return { kind: "issue", key: match[2].toUpperCase(), url: match[1] };
  if ((match = /linear\.app\/[^/]+\/(?:project|document)\/(.+)$/.exec(url))) {
    const name = match[1].replace(/-[0-9a-f]{8,}$/, "").replace(/-/g, " ");
    return { kind: "doc", key: url, url, title: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  if ((match = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url))) {
    const [, owner, repo, number] = match;
    return {
      kind: "pr",
      key: `${owner}/${repo}#${number}`.toLowerCase(),
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
      repo,
      number: Number(number),
    };
  }
  if ((match = /\/archives\/[A-Z0-9]+\/p(\d{10})\d{6}/.exec(url)))
    return { kind: "slack", key: url, url, at: Number(match[1]) * 1000 };
  return null;
}

// Bare ticket IDs count in uppercase only: "ABC-4601", not "utf-8".
export function startLinks(prompt) {
  const links = new Map();
  for (const url of prompt.match(new RegExp(URL_RE, "g")) ?? []) {
    const link = parse(url);
    if (link && !links.has(link.key)) links.set(link.key, link);
  }
  for (const id of prompt.match(/\b[A-Z]{2,6}-\d+\b/g) ?? [])
    if (!links.has(id)) links.set(id, { kind: "issue", key: id, url: null });
  return [...links.values()];
}

// "p1793274803396029" -> "1793274803.396029", the ts Slack's API and the MCP tools use.
export const slackTs = (url) => /\/p(\d{10})(\d{6})/.exec(url)?.slice(1).join(".") ?? null;

const plainSlack = (text) =>
  (text ?? "")
    .replace(/<[^|>]+\|([^>]+)>/g, "$1")
    .replace(/<!subteam\^[^>]+>/g, "@team")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .trim() || null;

// The text of the Slack MCP tool's slack_read_thread result: the parent's author, its first
// line and the reply count. Two formats: "=== THREAD PARENT MESSAGE ===" blocks, or a compact
// "THREAD: <text> [Author <email>]" line, then a "> Name <email>: text" line per reply.
export function parseThread(text) {
  const compact = /^THREAD: (.*) \[([^<\]]+?)(?: <[^>]*>)?\]$/m.exec(text);
  if (compact)
    return {
      author: compact[2],
      first: plainSlack(compact[1]),
      replies: (text.match(/^> [^\n:<]+<[^>\n]+>:/gm) ?? []).length,
    };
  const [parent, replies = ""] = text.split("=== THREAD REPLIES");
  const lines = parent.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Message TS:")) + 1;
  return {
    author: /^From: (.+?)(?: <| \(|$)/m.exec(parent)?.[1] ?? null,
    first: plainSlack(
      lines.slice(start).find((line) => line.trim() && !/^(Reactions|Files):/.test(line)),
    ),
    replies: Number(/^ \((\d+) total\)/.exec(replies)?.[1] ?? 0),
  };
}

// `=== false`: a PR fetched before the field existed reads as yours.
const reviewing = (pr) => pr?.viewerDidAuthor === false;

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const conflictsUrl = (pr) => (pr?.url ? `${pr.url}/conflicts` : null);

// An open thread whose last comment is from the PR's author is "answered": it only waits for Resolve.
export function reviewFacts(pr) {
  const author = pr?.author?.login;
  const open = (pr?.reviewThreads?.nodes ?? []).filter((thread) => !thread.isResolved);
  const lastComment = (thread) => thread.comments?.nodes?.[0];
  const answered = open.filter((thread) => author && lastComment(thread)?.author?.login === author);
  const toAnswer = open.filter((thread) => !answered.includes(thread));
  const changes = (pr?.latestReviews?.nodes ?? []).filter(
    (review) => review.state === "CHANGES_REQUESTED",
  );
  return {
    toAnswer: toAnswer.length,
    answered: answered.length,
    answerUrl: lastComment(toAnswer[0] ?? {})?.url ?? null,
    resolveUrl: lastComment(answered[0] ?? {})?.url ?? null,
    changesUrl: changes[0]?.url ?? null,
    changesBy: changes.map((review) => review.author?.login).filter(Boolean),
    reviewers: (pr?.reviewRequests?.nodes ?? [])
      .map((request) => request.requestedReviewer?.login ?? request.requestedReviewer?.name)
      .filter(Boolean),
  };
}

// tone: "act" (your turn), "dim" (waiting, or a fact) or "good". Checks are in checkList().
// On someone else's PR the author's to-dos are facts, not yours: they stay unlit.
export function readiness(pr) {
  if (!pr || pr.state !== "OPEN") return [];
  const lines = [],
    facts = reviewFacts(pr),
    by = (who) => (who.length ? ` · ${who.join(", ")}` : ""),
    act = reviewing(pr) ? "dim" : "act";
  if (!pr.isDraft) {
    if (pr.reviewDecision === "CHANGES_REQUESTED")
      lines.push({
        text: `Changes requested${by(facts.changesBy).replace(" · ", " by ")}`,
        tone: act,
        url: facts.changesUrl,
      });
    else if (pr.reviewDecision === "APPROVED") lines.push({ text: "Approved", tone: "good" });
    else if (pr.reviewDecision === "REVIEW_REQUIRED")
      lines.push({ text: `Needs review${by(facts.reviewers)}`, tone: "dim" });
  }
  if (facts.toAnswer)
    lines.push({
      text: `${plural(facts.toAnswer, "review comment")} to answer`,
      tone: act,
      url: facts.answerUrl,
    });
  if (facts.answered)
    lines.push({
      text: `${plural(facts.answered, "answered comment")} to resolve`,
      tone: act,
      url: facts.resolveUrl,
    });
  if (pr.mergeable === "CONFLICTING")
    lines.push({ text: `Conflicts with ${pr.baseRefName}`, tone: act, url: conflictsUrl(pr) });
  if (pr.autoMergeRequest) lines.push({ text: "Auto-merge on", tone: "dim" });
  return lines;
}

// `out` is bin/lasso-branch-state's output.
export function branchState(out) {
  const [head = "", dirty = "0", base = "", behind = "0", ahead = "0"] = out.split("\n");
  // With an upstream, "ahead" is in the header; without one, every commit past the base is unpushed.
  const unpushed = /\.\.\.\S+/.test(head)
    ? Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
    : Number(ahead) || 0;
  const parts = [];
  if (unpushed) parts.push(`${unpushed} not pushed`);
  if (Number(behind)) parts.push(`${behind} behind ${base.replace(/^origin\//, "")}`);
  if (Number(dirty)) parts.push(`${dirty} uncommitted`);
  return parts.join(" · ");
}

const DONE = new Set(["completed", "canceled"]);
export function linearLinks(issue) {
  const toLink = (related, blocked) => ({
    blocked,
    key: related.identifier,
    title: related.title,
    url: related.url,
    state: related.state,
    done: DONE.has(related.state?.type),
  });
  const blocks = [
    ...(issue?.inverseRelations?.nodes ?? [])
      .filter((relation) => relation.type === "blocks")
      .map((relation) => toLink(relation.issue, true)),
    ...(issue?.relations?.nodes ?? [])
      .filter((relation) => relation.type === "blocks")
      .map((relation) => toLink(relation.relatedIssue, false)),
  ];
  const children = issue?.children?.nodes ?? [];
  return {
    blocks,
    subs: children.length
      ? {
          done: children.filter((child) => DONE.has(child.state?.type)).length,
          total: children.length,
        }
      : null,
  };
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
const ORDER = ["failed", "running", "cancelled", "passed", "skipped"];
function checkState(check) {
  if (check.__typename === "StatusContext" || check.context)
    return check.state === "SUCCESS" ? "passed" : FAILED.has(check.state) ? "failed" : "running";
  if (check.status && check.status !== "COMPLETED") return "running";
  if (check.conclusion === "SUCCESS") return "passed";
  if (FAILED.has(check.conclusion)) return "failed";
  if (check.conclusion === "CANCELLED") return "cancelled";
  return "skipped";
}

// Worst first. The same name with the same state is one row with a count (a check that runs
// on every commit).
export function checkList(pr) {
  const rows = new Map();
  for (const check of pr?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []) {
    const name = check.name ?? check.context,
      state = checkState(check),
      key = `${name}\0${state}`;
    const row = rows.get(key);
    if (row) {
      row.count++;
      row.required ||= Boolean(check.isRequired);
    } else
      rows.set(key, {
        name,
        state,
        required: Boolean(check.isRequired),
        url: check.detailsUrl ?? check.targetUrl ?? null,
        count: 1,
      });
  }
  return [...rows.values()].sort(
    (a, b) =>
      ORDER.indexOf(a.state) - ORDER.indexOf(b.state) ||
      b.required - a.required ||
      a.name.localeCompare(b.name),
  );
}

// Headers: "## a...origin/a [ahead 2]", "## a", "## No commits yet on a". Detached: "".
export function branchName(head) {
  const match = /^## (?:No commits yet on )?(.+?)(?:\.\.\.| \[|$)/.exec(head ?? "");
  return !match || match[1].startsWith("HEAD (no branch)") ? "" : match[1];
}

// The merge commit's push runs whose workflow name starts with "Release" or "Deploy".
const RUN_FAILED = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]);
export function deployState(pr) {
  const runs = (pr?.mergeCommit?.checkSuites?.nodes ?? []).filter(
    (suite) => suite.workflowRun?.event === "push",
  );
  const find = (name) =>
    runs.find((suite) =>
      suite.workflowRun.workflow?.name?.toLowerCase().startsWith(name.toLowerCase()),
    );
  const stateOf = (name) => {
    const suite = find(name);
    if (!suite) return null;
    if (suite.status !== "COMPLETED") return "running";
    if (suite.conclusion === "SUCCESS") return "done";
    return RUN_FAILED.has(suite.conclusion) ? "failed" : null;
  };
  return {
    release: stateOf("Release"),
    deploy: stateOf("Deploy"),
    urls: {
      release: find("Release")?.workflowRun.url ?? null,
      deploy: find("Deploy")?.workflowRun.url ?? null,
    },
  };
}

export function afterMerge(pr) {
  if (pr?.state !== "MERGED") return [];
  const { release, deploy, urls } = deployState(pr);
  if (release === "failed") return [{ text: "Release failed", tone: "act", url: urls.release }];
  if (deploy === "failed") return [{ text: "Deploy failed", tone: "act", url: urls.deploy }];
  if (deploy === "done") return [{ text: "Deployed", tone: "good", url: urls.deploy }];
  if (deploy === "running") return [{ text: "Deploying", tone: "dim", url: urls.deploy }];
  if (release === "running") return [{ text: "Releasing", tone: "dim", url: urls.release }];
  if (release === "done") return [{ text: "Released", tone: "dim", url: urls.release }];
  return [];
}

// Nothing more will change: deployed, failed, or no runs 30 minutes after the merge.
export function deployFinal(pr, now = Date.now()) {
  const { release, deploy } = deployState(pr);
  if (deploy === "done" || deploy === "failed" || release === "failed") return true;
  return !release && !deploy && now - Date.parse(pr?.mergedAt ?? 0) > 30 * 60000;
}

// `yours`: the tasks mod's PR list. `base` is null when the base PR isn't yours.
export function stackLine(pr, yours, repo) {
  const baseName = pr?.baseRefName;
  if (pr?.state !== "OPEN" || !isFeatureBranch(baseName)) return null;
  const onBase = yours.filter((mine) => mine.repo === repo && mine.branch === baseName);
  const base = onBase.find((mine) => !mine.merged) ?? onBase[0];
  if (!base) return { text: `Stacked on ${baseName}`, tone: "dim", base: null, baseName };
  return base.merged
    ? {
        text: `Base #${base.number} is merged: rebase`,
        tone: "act",
        mergedBase: base.number,
        base,
        baseName,
      }
    : { text: `Stacked on #${base.number}`, tone: "dim", base, baseName };
}

// The first rule that holds wins: first what you can do now, then what you wait for.
export function nextStep({ pr, stack, blocks = [], issueState, reviewLabel }) {
  const blocker = blocks.find((block) => block.blocked && !block.done);
  const blocked = blocker && {
    text: `Blocked by ${blocker.key}`,
    tone: "dim",
    url: blocker.url ?? null,
  };
  if (!pr) return blocked ?? null;
  const say = (text, tone, url = pr.url ?? null) => ({ text, tone, url });
  if (pr.state === "MERGED") {
    const [after] = afterMerge(pr);
    if (after?.tone === "act") return after;
    if (after?.text === "Deployed")
      return say(`Deployed${issueState ? ` · ${issueState}` : ""}`, "good", after.url);
    return say(
      `Merged · ${after ? after.text.toLowerCase() : (issueState ?? "done")}`,
      "good",
      after?.url ?? pr.url,
    );
  }
  if (pr.state === "CLOSED") return say("PR closed without merge", "dim");
  const act = (text, url) => say(`Next: ${text}`, "act", url ?? pr.url ?? null);
  const labels = pr.labels?.nodes ?? [];
  if (labels.some((label) => /^do[ -]not[ -]merge$/i.test(label.name)))
    return say("On hold: do not merge", "dim");
  if (reviewing(pr)) return reviewStep(pr, say, act);
  if (stack?.mergedBase) return act(`rebase, base #${stack.mergedBase} is merged`);
  const checks = checkList(pr),
    failed = checks.filter((check) => check.state === "failed" && check.required);
  if (failed.length)
    return act(
      `fix ${failed[0].name}${failed.length > 1 ? ` and ${failed.length - 1} more` : ""}`,
      failed[0].url,
    );
  if (pr.mergeable === "CONFLICTING")
    return act(`resolve conflicts with ${pr.baseRefName}`, conflictsUrl(pr));
  const facts = reviewFacts(pr);
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    return act(
      `address the changes requested${facts.changesBy.length ? ` by ${facts.changesBy.join(", ")}` : ""}`,
      facts.changesUrl,
    );
  if (facts.toAnswer)
    return act(`answer ${plural(facts.toAnswer, "review comment")}`, facts.answerUrl);
  if (blocked) return blocked;
  if (pr.isDraft) return say("Draft: mark it ready when done", "dim");
  if (reviewLabel && !labels.some((label) => label.name === reviewLabel))
    return act(`post for review (${reviewLabel})`);
  if (facts.answered)
    return act(`resolve ${plural(facts.answered, "answered comment")}`, facts.resolveUrl);
  if (checks.some((check) => check.required && check.state === "running"))
    return say("Waiting for checks", "dim", pr.url ? `${pr.url}/checks` : null);
  if (pr.reviewDecision === "REVIEW_REQUIRED")
    return say(
      `Waiting for review${facts.reviewers.length ? ` · ${facts.reviewers.join(", ")}` : ""}`,
      "dim",
    );
  if (pr.reviewDecision === "APPROVED")
    return pr.autoMergeRequest ? say("Merges by itself", "good") : say("Ready to merge", "good");
  return null;
}

// The recap's steps, then your latest prompt when the recap does not have it yet. At most
// STEPS: the first step stays.
export function withLatest(steps = [], latest) {
  const last = steps.at(-1);
  if (!latest || (last && (last.at ?? 0) >= (latest.at ?? 0))) return steps;
  return [...(steps.length >= STEPS ? [steps[0], ...steps.slice(2)] : steps), latest];
}

// Your side of a review. "Replies": open threads where the author spoke last.
function reviewStep(pr, say, act) {
  const review = pr.viewerLatestReview?.state;
  if (pr.isDraft) return say("Draft: not ready for review yet", "dim");
  if (!review || review === "PENDING" || review === "DISMISSED") return act("review this PR");
  const facts = reviewFacts(pr);
  if (facts.answered)
    return act(`re-review, ${plural(facts.answered, "reply", "replies")}`, facts.resolveUrl);
  if (review === "APPROVED") return say("You approved", "good");
  return say("Waiting for the author", "dim");
}
