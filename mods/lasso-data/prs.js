// Shared state this file writes:
//   task.prs  { at, list, reviews, error }  your open and merged PRs, and open PRs you review

import { shared, setShared, exec } from "herdr";

const PR_QUERY = `query { viewer { pullRequests(states: [OPEN, MERGED], first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
  number title url headRefName isDraft reviewDecision updatedAt state repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
  requested: search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 100) { ...head }
  reviewed: search(query: "is:pr is:open reviewed-by:@me -author:@me", type: ISSUE, first: 100) { ...head } }
fragment head on SearchResultItemConnection { nodes { ... on PullRequest { url headRefName repository { name } } } }`;

export async function refreshPrs() {
  try {
    const result = await exec("gh", ["api", "graphql", "-f", `query=${PR_QUERY}`]);
    if (result.code !== 0)
      throw new Error(result.stderr.trim().split("\n")[0] || `gh exited with ${result.code}`);
    const data = JSON.parse(result.stdout).data;
    const list = data.viewer.pullRequests.nodes.map((node) => ({
      number: node.number,
      title: node.title,
      url: node.url,
      branch: node.headRefName,
      repo: node.repository.name,
      draft: node.isDraft,
      merged: node.state === "MERGED",
      review: node.reviewDecision,
      ci: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      updated: Date.parse(node.updatedAt),
    }));
    const reviews = [...data.requested.nodes, ...data.reviewed.nodes].map((node) => ({
      url: node.url,
      branch: node.headRefName,
      repo: node.repository.name,
    }));
    setShared("task.prs", { at: Date.now(), list, reviews, error: null });
  } catch (e) {
    setShared("task.prs", { ...shared("task.prs"), error: String(e?.message ?? e) });
  }
}
