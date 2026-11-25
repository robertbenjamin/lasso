// Fixture panels to look at the design: `tab.new {mod: "context", props: {demo: "review"}}`.
// Each one is a fake Context view (the fields panel() reads), with no network.
import { TOUR_REPO, worktreeRepo } from "./lib/shared.js";

const NOW = Date.now();
const state = (name, type, color) => ({ name, type, color });
const S = {
  progress: state("In Progress", "started", "#f2c94c"),
  review: state("In Review", "started", "#5e6ad2"),
  todo: state("Todo", "unstarted", "#e2e2e2"),
  done: state("Done", "completed", "#5e6ad2"),
  prod: state("On Production", "completed", "#4cb782"),
  triage: state("Triage", "triage", "#fc7840"),
};
const issue = (identifier, title, st, more = {}) => ({
  identifier,
  title,
  url: `https://linear.app/acme/issue/${identifier}`,
  state: st,
  ...more,
});
const check = (name, conclusion, required = false, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  isRequired: required,
  detailsUrl: "https://github.com/acme/api/actions",
});
const pr = (number, title, more = {}) => ({
  url: `https://github.com/acme/api/pull/${number}`,
  title,
  state: "OPEN",
  isDraft: false,
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  baseRefName: "main",
  author: { login: "me" },
  labels: { nodes: [] },
  reviewRequests: { nodes: [] },
  latestReviews: { nodes: [] },
  reviewThreads: { nodes: [] },
  commits: {
    nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [] } } } }],
  },
  ...more,
});
const rollup = (state, nodes) => ({
  nodes: [{ commit: { statusCheckRollup: { state, contexts: { nodes } } } }],
});
const thread = (url, login) => ({
  isResolved: false,
  comments: { nodes: [{ url, author: { login } }] },
});
const prLink = (number) => ({
  kind: "pr",
  key: `acme/api#${number}`,
  url: `https://github.com/acme/api/pull/${number}`,
  repo: "api",
  number,
});
const issueLink = (key) => ({ kind: "issue", key, url: null });
const slackLink = (id) => ({
  kind: "slack",
  key: id,
  url: `https://acme.slack.com/archives/C1/p${id}`,
  at: NOW - 2 * 86400000,
});

const DEMOS = {
  // An open PR with work to do: a failed check, review comments, a blocker, sub-issues.
  review: () => ({
    vm: {
      ticket: "API-101",
      card: [issueLink("API-101"), prLink(571)],
      more: [
        prLink(560),
        {
          kind: "doc",
          key: "doc",
          url: "https://linear.app/acme/document/x",
          title: "Rollout plan",
        },
      ],
    },
    issues: {
      "API-101": {
        data: issue("API-101", "Approve automerge PRs with the bot-approver app", S.progress, {
          parent: issue("API-90", "Automate dependency updates", S.progress),
          project: { name: "Dependency automation", url: "https://linear.app/acme/project/deps" },
          inverseRelations: {
            nodes: [
              { type: "blocks", issue: issue("OPS-12", "Create the bot-approver app", S.triage) },
            ],
          },
          relations: {
            nodes: [
              {
                type: "blocks",
                relatedIssue: issue("API-102", "Roll out automerge to every repo", S.todo),
              },
            ],
          },
          children: {
            nodes: [
              { state: { type: "completed" } },
              { state: { type: "completed" } },
              { state: { type: "started" } },
              { state: { type: "unstarted" } },
            ],
          },
        }),
      },
    },
    prs: {
      [prLink(571).url]: {
        data: pr(571, "fix: approve automerge PRs with the bot-approver app", {
          reviewDecision: "CHANGES_REQUESTED",
          latestReviews: {
            nodes: [
              { state: "CHANGES_REQUESTED", url: "https://github.com", author: { login: "ana" } },
            ],
          },
          reviewThreads: {
            nodes: [thread("https://github.com", "ana"), thread("https://github.com", "bo")],
          },
          labels: {
            nodes: [
              { name: "ready-for-review", color: "2da44e" },
              { name: "backend", color: "5e6ad2" },
            ],
          },
          commits: rollup("FAILURE", [
            check("test", "FAILURE", true),
            check("lint", "SUCCESS", true),
            check("build", "SUCCESS"),
            check("e2e", null, false, "IN_PROGRESS"),
          ]),
        }),
      },
    },
    git: { "/demo": { branch: "api-101-automerge", line: "2 not pushed · 1 uncommitted" } },
    recap: {
      summary: "PR open, review wants a smaller token scope",
      steps: [
        { at: NOW - 3 * 3600000, text: "Asked to approve automerge PRs with a bot" },
        { at: NOW - 2 * 3600000, text: "Chose a GitHub app over a PAT" },
        { at: NOW - 40 * 60000, text: "Opened the PR and fixed lint" },
        { at: NOW - 5 * 60000, text: "Started on Ana's token scope comment" },
      ],
    },
  }),
  // A Slack thread is the task: it comes first, with Haiku's summary.
  slack: () => ({
    vm: {
      ticket: "API-130",
      card: [slackLink("1793274803396029"), issueLink("API-130"), prLink(590)],
      more: [slackLink("1793000000000000")],
    },
    threads: {
      "https://acme.slack.com/archives/C1/p1793274803396029": {
        author: "Ana Lee",
        replies: 14,
        summary:
          "The team keeps the new draft categorization, which cut latency from 6 s to 1 s; drafts move to an async job",
      },
    },
    issues: { "API-130": { data: issue("API-130", "Create drafts in an async job", S.review) } },
    prs: {
      [prLink(590).url]: {
        data: pr(590, "feat: create drafts in an async job", {
          reviewDecision: "APPROVED",
          baseRefName: "api-129-queue",
          commits: rollup("PENDING", [
            check("test", null, true, "IN_PROGRESS"),
            check("lint", "SUCCESS", true),
          ]),
        }),
      },
    },
    mine: [
      {
        url: prLink(589).url,
        number: 589,
        repo: "api",
        branch: "api-129-queue",
        title: "feat: add the drafts queue",
        merged: false,
      },
    ],
    git: { "/demo": { branch: "api-130-async-drafts", line: "" } },
  }),
  // Merged and deployed: the quiet end state.
  merged: () => ({
    vm: { ticket: "API-77", card: [issueLink("API-77"), prLink(1182)], more: [] },
    issues: {
      "API-77": {
        data: issue("API-77", "Drop the HTML to markdown conversion", S.prod, {
          project: { name: "Cleanup", url: "https://linear.app/acme/project/cleanup" },
        }),
      },
    },
    prs: {
      [prLink(1182).url]: {
        data: pr(1182, "fix: drop the html to markdown conversion", {
          state: "MERGED",
          reviewDecision: "APPROVED",
          mergedAt: new Date(NOW - 3600000).toISOString(),
          labels: { nodes: [{ name: "ready-for-review", color: "2da44e" }] },
          mergeCommit: {
            checkSuites: {
              nodes: [
                {
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  workflowRun: {
                    url: "https://github.com",
                    event: "push",
                    workflow: { name: "Release" },
                  },
                },
                {
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  workflowRun: {
                    url: "https://github.com",
                    event: "push",
                    workflow: { name: "Deploy" },
                  },
                },
              ],
            },
          },
          commits: rollup("SUCCESS", [
            check("test", "SUCCESS", true),
            check("lint", "SUCCESS", true),
          ]),
        }),
      },
    },
    git: { "/demo": { branch: "main", line: "" } },
  }),
  // No link, only a branch with work on it.
  branch: () => ({
    vm: { ticket: null, card: [], more: [] },
    git: { "/demo": { branch: "berlin", line: "3 not pushed · 2 behind main" } },
  }),
  empty: () => ({ vm: { ticket: null, card: [], more: [] } }),
  // What the tour's scripted agent "works on" (mods/tour): a ticket, its PR and a recap.
  tour: () => ({
    demo: "sample data",
    vm: { ticket: "SHOP-42", card: [issueLink("SHOP-42"), prLink(128)], more: [] },
    issues: {
      "SHOP-42": {
        data: issue("SHOP-42", "Checkout test fails one run in ten", S.progress, {
          project: { name: "Stable CI", url: "https://linear.app/acme/project/stable-ci" },
        }),
      },
    },
    prs: {
      [prLink(128).url]: {
        data: pr(128, "fix: back off between payment retries", {
          labels: { nodes: [{ name: "ready-for-review", color: "2da44e" }] },
          reviewThreads: { nodes: [thread("https://github.com", "ana")] },
          commits: rollup("PENDING", [
            check("test", "SUCCESS", true),
            check("lint", "SUCCESS", true),
            check("e2e", null, false, "IN_PROGRESS"),
          ]),
        }),
      },
    },
    git: { "/demo": { branch: "shop-42-payment-backoff", line: "1 not pushed" } },
    recap: {
      summary: "Checkout test fixed, backoff PR open",
      steps: [
        { at: NOW - 6 * 60000, text: "Asked to fix the flaky checkout test" },
        { at: NOW - 4 * 60000, text: "Found the cause: retries with no backoff" },
        { at: NOW - 60000, text: "Opened a PR with the backoff" },
      ],
    },
  }),
};

export const demoNames = Object.keys(DEMOS);

export function demoView(name) {
  const fixture = (DEMOS[name] ?? DEMOS.review)();
  const mine = fixture.mine ?? [];
  return {
    demo: name,
    agent: { cwd: "/demo" },
    busy: false,
    open: true,
    othersOpen: new Set(),
    issues: {},
    prs: {},
    threads: {},
    git: {},
    ...fixture,
    vm: {
      ...fixture.vm,
      recap: fixture.recap ?? null,
      mine: new Map(mine.map((p) => [p.url.toLowerCase(), p])),
    },
  };
}

// An agent in the tour's demo repo gets the tour's fixture in place of real data.
export const sampleFor = (agent) =>
  worktreeRepo(agent.cwd) === TOUR_REPO ? demoView("tour") : null;
