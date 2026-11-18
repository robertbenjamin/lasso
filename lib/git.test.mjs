import { test } from "node:test";
import assert from "node:assert/strict";
import { prForBranch, worktreeRepo } from "./git.js";

test("prForBranch matches the repo when two repos share a branch name", () => {
  const prs = [
    { repo: "web", branch: "fix-login", merged: false },
    { repo: "api", branch: "fix-login", merged: true },
    { repo: "api", branch: "fix-login", merged: false },
  ];
  assert.equal(prForBranch(prs, "fix-login", "api"), prs[2]);
  assert.equal(prForBranch(prs, "fix-login", "web"), prs[0]);
  assert.equal(prForBranch(prs, "fix-login", null), prs[0]);
  assert.equal(prForBranch(prs, "main", "api"), null);
});

test("worktreeRepo", () => {
  assert.equal(worktreeRepo("/Users/me/.herdr/worktrees/api/fix-login/src"), "api");
  assert.equal(worktreeRepo("/Users/me/code/api"), null);
});
