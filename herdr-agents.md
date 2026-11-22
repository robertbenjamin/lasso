# Herdr: child agents and worktrees

`install.sh` links this file into `~/.claude/rules/`, so Claude Code loads it in every session.
These rules win over a general "no worktrees" rule: a PR started with `herdr-child --worktree`
gets its own worktree.

- **For several PRs from one task, or for a side task (an exploration, a check), start each one
  as a child agent with `herdr-child`.** The child becomes an hc child of this session, so the
  sidebar and the Work board nest it under this session. Its pane goes in the current tab, on
  the right in columns of two: odd children start a new column, even ones go below. Do not open new tabs.
- Never use `herdr-app do terminal.open` or `tab.new` with `claude` for child agents. They get no
  parent, so they show flat.
- How:
  - PR (code change): `herdr-child --worktree <repo> <branch> "<task>"`. It makes the worktree
    with `herdr-worktree` (from a fresh `origin/HEAD`, at `~/.herdr/worktrees/<repo>/<branch>`).
  - Side task in this folder: `herdr-child --name <short-name> "<task>"`.
  - Side task in another repo: `herdr-child --folder <path> --name <short-name> "<task>"`.
  - In another space: add `--space <space name or id>`.
  - Model or effort: add `--model <model>` and `--effort <level>`. Never send `/model` or
    `/effort` with `hc send` or `hc keys`. They do not run, and they become the child's title.
  - Always give the task when you start the child, so that it is the first message.
- A PR that depends on another PR: first run `git -C <repo> branch <branch> <parent branch>`, then
  `herdr-child --worktree <repo> <branch> …`. Open it with `--base <parent branch>`.
- `herdr-child` prints the child's address (for example `t7`). Use `hc read`, `hc wait` and
  `hc send <address>` to follow it. To wait for several children, run `hc wait --children all`
  (until all are done) or `--children any` (the next one's news), never a sleep. hc types a note into this session when a child is blocked or
  exits. You cannot answer a child's permission prompts: tell the user which pane waits.
- **An agent that already runs cannot get a parent.** To nest it, start it again with
  `herdr-child --folder <its folder> --name <name> --resume <session id>`. The session id is the
  newest `.jsonl` in `~/.claude/projects/<folder, / and . as ->/`. Then the user stops the old one.
- For a new piece of work in its own space, run
  `herdr-open-work --repo <repo> [--branch <branch>] -- "<task>"` (the same script as the ⌘⇧N
  New work dialog). It makes the worktree, opens the repo's space when it is not open, and
  opens the work as a space named after the repo, under it. No branch: a free city name. `--repo home`: the
  work folder (`workRoot` in `lasso.json`): a worktree of it when it is a git repo, else a new
  tab there. `--repo auto`: it picks the repo from the task. Use this, not
  `herdr-worktree --open`: only this one finds the repo, the branch or the PR's branch for you.
- After a change to the New work flow (`mods/new-work`, `mods/tasks-spaces`, `herdr-open-work`,
  `herdr-worktree`), run `herdr-new-work-test` before you say it works.
