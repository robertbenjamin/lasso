import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  startLinks,
  readiness,
  branchState,
  linearLinks,
  checkList,
  branchName,
  deployState,
  afterMerge,
  deployFinal,
  stackLine,
  nextStep,
  slackTs,
  parseThread,
} from "./links.js";

// PR data as GitHub returns it, open unless `x` says otherwise. `open` also has the review label.
const pr = (x) => ({
  state: "OPEN",
  isDraft: false,
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  baseRefName: "master",
  ...x,
});
const open = (x) => ({
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  baseRefName: "master",
  reviewDecision: "REVIEW_REQUIRED",
  labels: { nodes: [{ name: "ready-for-review" }] },
  ...x,
});
const thread = (resolved, last) => ({
  isResolved: resolved,
  comments: { nodes: [{ author: { login: last } }] },
});
const suite = (name, status, conclusion, event = "push") => ({
  status,
  conclusion,
  workflowRun: { event, workflow: { name } },
});
const merged = (...s) => ({
  state: "MERGED",
  mergedAt: "2026-11-06T10:00:00Z",
  mergeCommit: { checkSuites: { nodes: s } },
});
const req = (name, conclusion, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  isRequired: true,
});
const withChecks = (...c) => ({
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: c } } } }] },
});
const yours = [
  { number: 457, repo: "sq", branch: "abc-1-a", merged: false },
  { number: 450, repo: "sq", branch: "abc-2", merged: true },
];

test("links", () => {
  assert.deepEqual(parse("https://linear.app/acme/issue/abc-4399/drop-tables"), {
    kind: "issue",
    key: "ABC-4399",
    url: "https://linear.app/acme/issue/abc-4399",
  });
  assert.equal(parse("https://github.com/acme/Data/pull/7750/files").key, "acme/data#7750");
  assert.equal(
    parse("https://github.com/acme/data/pull/7750/files").url,
    "https://github.com/acme/data/pull/7750",
  );
  assert.equal(
    parse("https://acme.slack.com/archives/C0123ABCD/p1793370325995259").at,
    1793370325000,
  );
  assert.equal(
    parse("https://linear.app/acme/document/cleanup-backlog-3f2a9c1d8e7b").title,
    "Cleanup backlog",
  );
  assert.equal(parse("https://example.com/x"), null);

  // "/some-command ABC-4601": a bare ID; a URL and its own ID count once; lowercase "utf-8" is no ticket.
  assert.deepEqual(
    startLinks("<command-args>ABC-4601</command-args>").map((l) => l.key),
    ["ABC-4601"],
  );
  const s = startLinks(
    "https://linear.app/acme/issue/ABC-4399 . PR 2 of 2, see https://acme.slack.com/archives/C1/p1793370325995259 and ABC-4399, utf-8",
  );
  assert.deepEqual(
    s.map((l) => l.kind),
    ["issue", "slack"],
  );
});

test("slack", () => {
  assert.equal(
    slackTs("https://acme.slack.com/archives/C1/p1793274803396029"),
    "1793274803.396029",
  );
  const thread = [
    "=== THREAD PARENT MESSAGE ===",
    "From: Ana Lee <ana@acme.com> (U1)",
    "Time: 2026-10-29 12:53:23 CET",
    "Message TS: 1793274803.396029",
    "",
    "<@U2|Bo> can you check <https://x.dev/a|the deploy> for <!subteam^S1>?",
    "second line",
    "Reactions: eyes (1)",
    "",
    "=== THREAD REPLIES (3 total) ===",
    "--- Reply 1 of 3 ---",
  ].join("\n");
  assert.deepEqual(parseThread(thread), {
    author: "Ana Lee",
    first: "Bo can you check the deploy for @team?",
    replies: 3,
  });
  assert.deepEqual(
    parseThread(
      "THREAD: `CreateDraft` is slow [Ana Lee <ana@acme.com>]\n\n> Ana Lee <ana@acme.com>: still\nslow\n> Bo <bo@acme.com>: ok",
    ),
    { author: "Ana Lee", first: "`CreateDraft` is slow", replies: 2 },
  );
  assert.deepEqual(parseThread("=== THREAD PARENT MESSAGE ===\nFrom: Bot\nMessage TS: 1.2"), {
    author: "Bot",
    first: null,
    replies: 0,
  });
});

test("rules", () => {
  const texts = (x) => readiness(pr(x)).map((l) => l.text);
  assert.deepEqual(
    texts({
      reviewRequests: { nodes: [{ requestedReviewer: { name: "backend-team" } }] },
      autoMergeRequest: {},
    }),
    ["Needs review · backend-team", "Auto-merge on"],
  );
  assert.deepEqual(
    texts({
      reviewDecision: "CHANGES_REQUESTED",
      latestReviews: { nodes: [{ state: "CHANGES_REQUESTED", author: { login: "anna" } }] },
      mergeable: "CONFLICTING",
    }),
    ["Changes requested by anna", "Conflicts with master"],
  );
  const checks = {
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: "FAILURE",
              contexts: {
                nodes: [
                  { name: "lint", conclusion: "FAILURE" },
                  { name: "test", conclusion: "FAILURE" },
                  { name: "test", conclusion: "FAILURE" },
                  { name: "build", conclusion: "SUCCESS" },
                  { context: "ci/old", state: "ERROR" },
                ],
              },
            },
          },
        },
      ],
    },
  };
  assert.deepEqual(
    texts({
      ...checks,
      author: { login: "rob" },
      reviewDecision: "APPROVED",
      reviewThreads: {
        nodes: [
          thread(false, "anna"),
          thread(true, "anna"),
          thread(false, "rob"),
          thread(false, "rob"),
        ],
      },
    }),
    ["Approved", "1 review comment to answer", "2 answered comments to resolve"],
  );
  assert.deepEqual(texts({ isDraft: true }), []);
  assert.deepEqual(readiness(pr({ state: "MERGED" })), []);

  assert.equal(
    branchState("## ABC-1...origin/ABC-1 [ahead 2, behind 1]\n5\norigin/master\n14\n9"),
    "2 not pushed · 14 behind master · 5 uncommitted",
  );
  assert.equal(branchState("## ABC-1\n0\norigin/master\n0\n3"), "3 not pushed");
  assert.equal(branchState("## ABC-1...origin/ABC-1 [gone]\n0\norigin/master\n0\n0"), "");

  const st = (type) => ({ name: type, type, color: "#000" });
  const l = linearLinks({
    inverseRelations: {
      nodes: [
        { type: "blocks", issue: { identifier: "ABC-4398", state: st("completed") } },
        { type: "related", issue: { identifier: "ABC-1", state: st("started") } },
      ],
    },
    relations: {
      nodes: [{ type: "blocks", relatedIssue: { identifier: "ABC-4400", state: st("unstarted") } }],
    },
    children: { nodes: [{ state: st("completed") }, { state: st("started") }] },
  });
  assert.deepEqual(
    l.blocks.map((b) => [b.key, b.blocked, b.done]),
    [
      ["ABC-4398", true, true],
      ["ABC-4400", false, false],
    ],
  );
  assert.deepEqual(l.subs, { done: 1, total: 2 });
  assert.equal(linearLinks({ children: { nodes: [] } }).subs, null);
});

test("checks", () => {
  const run = (x) => ({ __typename: "CheckRun", status: "COMPLETED", ...x });
  const list = checkList({
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  run({ name: "claude", conclusion: "SKIPPED" }),
                  run({ name: "claude", conclusion: "SKIPPED" }),
                  run({ name: "scan", conclusion: "SUCCESS", detailsUrl: "https://gh/scan" }),
                  run({ name: "build", status: "IN_PROGRESS", conclusion: null }),
                  {
                    __typename: "StatusContext",
                    context: "ci/circleci: test",
                    state: "FAILURE",
                    isRequired: true,
                    targetUrl: "https://circleci/test",
                  },
                  {
                    __typename: "StatusContext",
                    context: "ci/circleci: lint",
                    state: "SUCCESS",
                    isRequired: true,
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
  assert.deepEqual(
    list.map((c) => [c.name, c.state, c.required, c.count]),
    [
      ["ci/circleci: test", "failed", true, 1],
      ["build", "running", false, 1],
      ["ci/circleci: lint", "passed", true, 1],
      ["scan", "passed", false, 1],
      ["claude", "skipped", false, 2],
    ],
  );
  assert.equal(list[0].url, "https://circleci/test");
  assert.deepEqual(checkList(null), []);
});

test("branch", () => {
  assert.equal(branchName("## ABC-1...origin/ABC-1 [ahead 2]"), "ABC-1");
  assert.equal(branchName("## release-1.2...origin/release-1.2"), "release-1.2");
  assert.equal(branchName("## ABC-1"), "ABC-1");
  assert.equal(branchName("## No commits yet on main"), "main");
  assert.equal(branchName("## HEAD (no branch)"), "");
});

test("next", () => {
  assert.deepEqual(
    deployState(
      merged(
        suite("Release", "COMPLETED", "SUCCESS"),
        suite("Deploy", "IN_PROGRESS", null),
        suite("Claude Code", "COMPLETED", "SKIPPED", "issue_comment"),
      ),
    ),
    { release: "done", deploy: "running", urls: { release: null, deploy: null } },
  );
  assert.deepEqual(
    afterMerge(
      merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "IN_PROGRESS", null)),
    ).map((x) => x.text),
    ["Deploying"],
  );
  assert.deepEqual(
    afterMerge(
      merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "COMPLETED", "FAILURE")),
    ).map((x) => x.text),
    ["Deploy failed"],
  );
  assert.deepEqual(afterMerge({ state: "OPEN" }), []);
  assert.equal(deployFinal(merged(suite("Deploy", "COMPLETED", "SUCCESS"))), true);
  assert.equal(deployFinal(merged(suite("Release", "IN_PROGRESS", null))), false);
  assert.equal(deployFinal(merged(), Date.parse("2026-11-06T10:10:00Z")), false);
  assert.equal(deployFinal(merged(), Date.parse("2026-11-06T11:00:00Z")), true);

  assert.equal(stackLine({ state: "OPEN", baseRefName: "master" }, yours, "sq"), null);
  assert.equal(
    stackLine({ state: "OPEN", baseRefName: "abc-1-a" }, yours, "sq").text,
    "Stacked on #457",
  );
  assert.equal(
    stackLine({ state: "OPEN", baseRefName: "abc-2" }, yours, "sq").text,
    "Base #450 is merged: rebase",
  );
  assert.equal(
    stackLine({ state: "OPEN", baseRefName: "someone-else" }, yours, "sq").text,
    "Stacked on someone-else",
  );

  const next = (x, more = {}) =>
    nextStep({ pr: open(x), reviewLabel: "ready-for-review", ...more })?.text;
  assert.equal(
    next({ reviewRequests: { nodes: [{ requestedReviewer: { name: "backend-team" } }] } }),
    "Waiting for review · backend-team",
  );
  assert.equal(
    next(withChecks(req("ci/circleci: lint", "FAILURE"), req("test", "FAILURE"))),
    "Next: fix ci/circleci: lint and 1 more",
  );
  assert.equal(next(withChecks(req("test", null, "IN_PROGRESS"))), "Waiting for checks");
  assert.equal(next({ mergeable: "CONFLICTING" }), "Next: resolve conflicts with master");
  assert.equal(
    next({
      reviewDecision: "CHANGES_REQUESTED",
      latestReviews: { nodes: [{ state: "CHANGES_REQUESTED", author: { login: "anna" } }] },
    }),
    "Next: address the changes requested by anna",
  );
  assert.equal(
    next({
      author: { login: "rob" },
      reviewThreads: { nodes: [thread(false, "anna"), thread(false, "ben")] },
    }),
    "Next: answer 2 review comments",
  );
  // #7750: the reviewer's question is answered by the author (its Claude), so it waits for "Resolve".
  assert.equal(
    next({
      author: { login: "rob" },
      reviewDecision: "APPROVED",
      reviewThreads: { nodes: [thread(false, "rob")] },
    }),
    "Next: resolve 1 answered comment",
  );
  assert.equal(next({ labels: { nodes: [] } }), "Next: post for review (ready-for-review)");
  assert.equal(next({ labels: { nodes: [] } }, { reviewLabel: "" }), "Waiting for review");
  assert.equal(next({ isDraft: true, labels: { nodes: [] } }), "Draft: mark it ready when done");
  assert.equal(next({ reviewDecision: "APPROVED", autoMergeRequest: {} }), "Merges by itself");
  assert.equal(next({ reviewDecision: "APPROVED" }), "Ready to merge");
  assert.equal(
    next({
      mergeable: "CONFLICTING",
      labels: { nodes: [{ name: "do not merge" }, { name: "ready-for-review" }] },
    }),
    "On hold: do not merge",
  );
  assert.equal(
    next(
      { baseRefName: "abc-2" },
      { stack: stackLine(open({ baseRefName: "abc-2" }), yours, "sq") },
    ),
    "Next: rebase, base #450 is merged",
  );
  const blocks = [{ key: "ABC-4398", blocked: true, done: false }];
  assert.equal(nextStep({ pr: null, blocks }).text, "Blocked by ABC-4398");
  assert.equal(next({}, { blocks }), "Blocked by ABC-4398");
  assert.equal(
    nextStep({
      pr: merged(suite("Release", "COMPLETED", "SUCCESS"), suite("Deploy", "COMPLETED", "SUCCESS")),
      issueState: "On Dev",
    }).text,
    "Deployed · On Dev",
  );
  assert.equal(
    nextStep({ pr: merged(suite("Release", "IN_PROGRESS", null)) }).text,
    "Merged · releasing",
  );
  assert.equal(nextStep({ pr: merged(), issueState: "On Dev" }).text, "Merged · On Dev");
  assert.equal(nextStep({ pr: null }), null);
});

// The exact spots: each line and answer opens where you act.
test("spots", () => {
  const P = "https://github.com/o/r/pull/9";
  const at = (url) => ({
    isResolved: false,
    comments: { nodes: [{ url, author: { login: "anna" } }] },
  });
  const mineAt = (url) => ({
    isResolved: false,
    comments: { nodes: [{ url, author: { login: "rob" } }] },
  });
  const spots = {
    url: P,
    author: { login: "rob" },
    reviewThreads: { nodes: [mineAt(`${P}#r2`), at(`${P}#r1`)] },
  };
  assert.deepEqual(
    readiness(open(spots))
      .map((l) => l.url)
      .filter(Boolean),
    [`${P}#r1`, `${P}#r2`],
  );
  assert.equal(nextStep({ pr: open(spots) }).url, `${P}#r1`);
  assert.equal(
    nextStep({
      pr: open({ url: P, author: { login: "rob" }, reviewThreads: { nodes: [mineAt(`${P}#r2`)] } }),
    }).url,
    `${P}#r2`,
  );
  assert.equal(nextStep({ pr: open({ url: P, mergeable: "CONFLICTING" }) }).url, `${P}/conflicts`);
  assert.equal(
    nextStep({
      pr: open({
        url: P,
        ...withChecks({ ...req("lint", "FAILURE"), detailsUrl: "https://ci/lint" }),
      }),
    }).url,
    "https://ci/lint",
  );
  assert.equal(
    nextStep({
      pr: open({
        url: P,
        reviewDecision: "CHANGES_REQUESTED",
        latestReviews: {
          nodes: [{ state: "CHANGES_REQUESTED", url: `${P}#review-1`, author: { login: "anna" } }],
        },
      }),
    }).url,
    `${P}#review-1`,
  );
  const failedDeploy = merged(suite("Release", "COMPLETED", "SUCCESS"), {
    ...suite("Deploy", "COMPLETED", "FAILURE"),
    workflowRun: { url: "https://gh/run/7", event: "push", workflow: { name: "Deploy" } },
  });
  assert.equal(nextStep({ pr: failedDeploy }).url, "https://gh/run/7");
  assert.equal(
    nextStep({
      pr: null,
      blocks: [{ key: "ABC-1", blocked: true, done: false, url: "https://linear/ABC-1" }],
    }).url,
    "https://linear/ABC-1",
  );
});
