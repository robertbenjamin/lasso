// node mods/context/links.check.mjs: fails loudly if the link parsing breaks.
import assert from "node:assert/strict";
import { parse, startLinks } from "./links.js";

assert.deepEqual(parse("https://linear.app/join-com/issue/thu-4399/drop-tables"), { kind: "issue", key: "THU-4399", url: "https://linear.app/join-com/issue/thu-4399" });
assert.equal(parse("https://github.com/join-com/Data/pull/7750/files").key, "join-com/data#7750");
assert.equal(parse("https://github.com/join-com/data/pull/7750/files").url, "https://github.com/join-com/data/pull/7750");
assert.equal(parse("https://join-com.slack.com/archives/CA02AU0EP/p1793370325995259").at, 1793370325000);
assert.equal(parse("https://linear.app/join-com/document/cleanup-backlog-3f2a9c1d8e7b").title, "Cleanup backlog");
assert.equal(parse("https://example.com/x"), null);

// "/make-pr THU-4601": a bare ID; a URL and its own ID count once; lowercase "utf-8" is no ticket.
assert.deepEqual(startLinks("<command-args>THU-4601</command-args>").map((l) => l.key), ["THU-4601"]);
const s = startLinks("https://linear.app/join-com/issue/THU-4399 . PR 2 of 2, see https://join-com.slack.com/archives/C1/p1793370325995259 and THU-4399, utf-8");
assert.deepEqual(s.map((l) => l.kind), ["issue", "slack"]);
console.log("links ok");

import { readiness, branchState, linearLinks } from "./links.js";
const pr = (x) => ({ state: "OPEN", isDraft: false, reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", baseRefName: "master", ...x });
const texts = (x) => readiness(pr(x)).map((l) => l.text);
assert.deepEqual(texts({ reviewRequests: { nodes: [{ requestedReviewer: { name: "backend-thunder" } }] }, autoMergeRequest: {} }), ["Needs review · backend-thunder", "Auto-merge on"]);
assert.deepEqual(texts({ reviewDecision: "CHANGES_REQUESTED", latestReviews: { nodes: [{ state: "CHANGES_REQUESTED", author: { login: "anna" } }] }, mergeable: "CONFLICTING" }), ["Changes requested by anna", "Conflicts with master"]);
const checks = { commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE", contexts: { nodes: [{ name: "lint", conclusion: "FAILURE" }, { name: "test", conclusion: "FAILURE" }, { name: "test", conclusion: "FAILURE" }, { name: "build", conclusion: "SUCCESS" }, { context: "ci/old", state: "ERROR" }] } } } }] } };
assert.deepEqual(texts({ ...checks, reviewDecision: "APPROVED", reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } }), ["Approved", "1 unresolved comment"]);
assert.deepEqual(texts({ isDraft: true }), []);
assert.deepEqual(readiness(pr({ state: "MERGED" })), []);

assert.equal(branchState("## THU-1...origin/THU-1 [ahead 2, behind 1]\n5\norigin/master\n14\n9"), "2 not pushed · 14 behind master · 5 uncommitted");
assert.equal(branchState("## THU-1\n0\norigin/master\n0\n3"), "3 not pushed");
assert.equal(branchState("## THU-1...origin/THU-1 [gone]\n0\norigin/master\n0\n0"), "");

const st = (type) => ({ name: type, type, color: "#000" });
const l = linearLinks({
  inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "THU-4398", state: st("completed") } }, { type: "related", issue: { identifier: "THU-1", state: st("started") } }] },
  relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "THU-4400", state: st("unstarted") } }] },
  children: { nodes: [{ state: st("completed") }, { state: st("started") }] },
});
assert.deepEqual(l.blocks.map((b) => [b.key, b.blocked, b.done]), [["THU-4398", true, true], ["THU-4400", false, false]]);
assert.deepEqual(l.subs, { done: 1, total: 2 });
assert.equal(linearLinks({ children: { nodes: [] } }).subs, null);
console.log("rules ok");

import { checkList } from "./links.js";
const run = (x) => ({ __typename: "CheckRun", status: "COMPLETED", ...x });
const list = checkList({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
  run({ name: "claude", conclusion: "SKIPPED" }), run({ name: "claude", conclusion: "SKIPPED" }),
  run({ name: "scan", conclusion: "SUCCESS", detailsUrl: "https://gh/scan" }),
  run({ name: "build", status: "IN_PROGRESS", conclusion: null }),
  { __typename: "StatusContext", context: "ci/circleci: test", state: "FAILURE", isRequired: true, targetUrl: "https://circleci/test" },
  { __typename: "StatusContext", context: "ci/circleci: lint", state: "SUCCESS", isRequired: true },
] } } } }] } });
assert.deepEqual(list.map((c) => [c.name, c.state, c.required, c.count]), [
  ["ci/circleci: test", "failed", true, 1], ["build", "running", false, 1],
  ["ci/circleci: lint", "passed", true, 1], ["scan", "passed", false, 1], ["claude", "skipped", false, 2]]);
assert.equal(list[0].url, "https://circleci/test");
assert.deepEqual(checkList(null), []);
console.log("checks ok");

import { branchName } from "./links.js";
assert.equal(branchName("## THU-1...origin/THU-1 [ahead 2]"), "THU-1");
assert.equal(branchName("## release-1.2...origin/release-1.2"), "release-1.2");
assert.equal(branchName("## THU-1"), "THU-1");
assert.equal(branchName("## No commits yet on main"), "main");
assert.equal(branchName("## HEAD (no branch)"), "");
console.log("branch ok");

import { deployState, afterMerge, deployFinal, stackLine, nextStep } from "./links.js";
const suite = (name, status, conclusion, event = "push") => ({ status, conclusion, workflowRun: { event, workflow: { name } } });
const merged = (...s) => ({ state: "MERGED", mergedAt: "2026-11-06T10:00:00Z", mergeCommit: { checkSuites: { nodes: s } } });
assert.deepEqual(deployState(merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "IN_PROGRESS", null), suite("Claude Code", "COMPLETED", "SKIPPED", "issue_comment"))), { release: "done", deploy: "running" });
assert.deepEqual(afterMerge(merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "IN_PROGRESS", null))).map((x) => x.text), ["Deploying"]);
assert.deepEqual(afterMerge(merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "COMPLETED", "FAILURE"))).map((x) => x.text), ["Deploy failed"]);
assert.deepEqual(afterMerge({ state: "OPEN" }), []);
assert.equal(deployFinal(merged(suite("Deploy", "COMPLETED", "SUCCESS"))), true);
assert.equal(deployFinal(merged(suite("Release", "IN_PROGRESS", null))), false);
assert.equal(deployFinal(merged(), Date.parse("2026-11-06T10:10:00Z")), false);
assert.equal(deployFinal(merged(), Date.parse("2026-11-06T11:00:00Z")), true);

const yours = [{ number: 457, repo: "sq", branch: "thu-1-a", merged: false }, { number: 450, repo: "sq", branch: "thu-2", merged: true }];
assert.equal(stackLine({ state: "OPEN", baseRefName: "master" }, yours, "sq"), null);
assert.equal(stackLine({ state: "OPEN", baseRefName: "thu-1-a" }, yours, "sq").text, "Stacked on #457");
assert.equal(stackLine({ state: "OPEN", baseRefName: "thu-2" }, yours, "sq").text, "Base #450 is merged: rebase");
assert.equal(stackLine({ state: "OPEN", baseRefName: "someone-else" }, yours, "sq").text, "Stacked on someone-else");

const open = (x) => ({ state: "OPEN", isDraft: false, mergeable: "MERGEABLE", baseRefName: "master", reviewDecision: "REVIEW_REQUIRED", labels: { nodes: [{ name: "ready-for-review" }] }, ...x });
const next = (x, more = {}) => nextStep({ g: open(x), ...more })?.text;
const req = (name, conclusion, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion, isRequired: true });
const withChecks = (...c) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: c } } } }] } });
assert.equal(next({ reviewRequests: { nodes: [{ requestedReviewer: { name: "backend-thunder" } }] } }), "Waiting for review · backend-thunder");
assert.equal(next(withChecks(req("ci/circleci: lint", "FAILURE"), req("test", "FAILURE"))), "Next: fix ci/circleci: lint and 1 more");
assert.equal(next(withChecks(req("test", null, "IN_PROGRESS"))), "Waiting for checks");
assert.equal(next({ mergeable: "CONFLICTING" }), "Next: resolve conflicts with master");
assert.equal(next({ reviewDecision: "CHANGES_REQUESTED", latestReviews: { nodes: [{ state: "CHANGES_REQUESTED", author: { login: "anna" } }] } }), "Next: address the changes requested by anna");
assert.equal(next({ reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }] } }), "Next: answer 2 open review comments");
assert.equal(next({ labels: { nodes: [] } }), "Not posted for review");
assert.equal(next({ isDraft: true, labels: { nodes: [] } }), "Draft: mark it ready when done");
assert.equal(next({ reviewDecision: "APPROVED", autoMergeRequest: {} }), "Merges by itself");
assert.equal(next({ reviewDecision: "APPROVED" }), "Ready to merge");
assert.equal(next({ baseRefName: "thu-2" }, { stack: stackLine(open({ baseRefName: "thu-2" }), yours, "sq") }), "Next: rebase, base #450 is merged");
const blocks = [{ key: "THU-4398", blocked: true, done: false }];
assert.equal(nextStep({ g: null, blocks }).text, "Blocked by THU-4398");
assert.equal(next({}, { blocks }), "Blocked by THU-4398");
assert.equal(nextStep({ g: merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "COMPLETED", "SUCCESS")), issueState: "On Dev" }).text, "Deployed · On Dev");
assert.equal(nextStep({ g: merged(suite("Release", "IN_PROGRESS", null)) }).text, "Merged · releasing");
assert.equal(nextStep({ g: merged(), issueState: "On Dev" }).text, "Merged · On Dev");
assert.equal(nextStep({ g: null }), null);
console.log("next ok");
