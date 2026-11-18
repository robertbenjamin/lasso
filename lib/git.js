export const TICKET = /\b([a-z]{2,6}-\d+)\b/i;

export const DEFAULT_BRANCHES = new Set(["master", "main", "develop"]);
export const isFeatureBranch = (branch) => Boolean(branch) && !DEFAULT_BRANCHES.has(branch);

// ~/.herdr/worktrees/<repo>/<folder>
export const WORKTREE = /\/\.herdr\/worktrees\/([^/]+)\/([^/]+)/;
export const worktreeRepo = (cwd) => cwd?.match(WORKTREE)?.[1] ?? null;

// Two repos can share a branch name, so match the repo too when we know it.
export function prsOnBranch(prs, branch, repo) {
  if (!isFeatureBranch(branch)) return [];
  const onBranch = prs.filter((pr) => pr.branch === branch);
  const inRepo = onBranch.filter((pr) => pr.repo === repo);
  return inRepo.length ? inRepo : onBranch;
}

export function prForBranch(prs, branch, repo) {
  const matches = prsOnBranch(prs, branch, repo);
  return matches.find((pr) => !pr.merged) ?? matches[0] ?? null;
}
