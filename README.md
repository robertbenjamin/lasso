# lasso

A Herdr setup for running many Claude Code agents at once: a custom layout, mods, keys and
helper scripts. The repo is `~/.config/herdr-app` itself. The `.gitignore` lets in only the
files lasso adds. Stock mods, Herdr state (`shared.json`, `view.json`, `data/`) and your own
files (`lasso.json`, `linear-key`) stay out.

## Contents

- `layouts/main-tasks.json`: the main layout.
- `mods/tasks*`: the sidebar (Recurring, Ship, Side), the Work board, the tabs and the panes.
  An agent that waits on a screen before it starts (Claude's folder trust, login, MCP
  approval) reports no status, so Herdr doesn't list it: the sidebar shows it under Needs you.
- `mods/new-work`: the New work dialog (⌘⇧N). Paste a ticket, a PR link or a note, and Claude
  starts in a new worktree.
- `mods/claude-footer`: Claude usage (5 hours and week) in the sidebar footer.
- `mods/context`: the Context panel (button next to Changes): the focused agent's ticket, PRs
  with their blockers and checks, its branch state, and the links it mentioned later.
  `node mods/context/links.check.mjs` tests its rules.
- `bin/herdr-*`: the helper scripts (`herdr-child`, `herdr-open-work`, `herdr-worktree`, ...).
- `herdr-agents.md`: the agent instructions for child agents and worktrees.

## Requirements

- macOS and Herdr 0.1.13 or later. The mods are cloned from the stock 0.1.13 mods and use
  their icons.
- `claude` (Claude Code, logged in), `gh` (logged in), `git`, `zsh`, `python3`, `curl`.
- What each feature needs:
  - **PRs on the board and in the Context panel**: `gh` logged in.
  - **Tab titles**: the `claude` CLI. Each title is one short Haiku call.
  - **Usage footer**: Claude Code logged in on this Mac. It reads the login from the
    keychain and calls the usage endpoint behind `/usage`, which is not documented and can
    change.
  - **Linear tickets in the Context panel and in New work**: a Linear API key in the file
    `linear-key` (or `$LINEAR_API_KEY`). Without a key, New work asks Claude through the
    claude.ai Linear connector, which is slower.

## Set up

1. Run `xcode-select --install` (for `git`, `python3` and `curl`).
2. Install Claude Code and log in.
3. Run `brew install gh`, then `gh auth login` with an account that can read lasso.
4. Install Herdr and start it once.
5. Run this, with the folder that holds your repos:
   ```sh
   gh repo clone <owner>/lasso /tmp/lasso && /tmp/lasso/install.sh --work-root ~/code
   ```
6. Restart Herdr. Then run `herdr-app status`: its `errors` list must be empty.
7. Run `herdr-new-work-test` to test the New work flow.

`install.sh` copies the files into `~/.config/herdr-app` and moves the clone's `.git` there,
so you can commit in place. It writes `lasso.json` with `workRoot`, links `bin/herdr-*` into
`~/.local/bin` and adds the `herdr-agents.md` import to `~/.claude/CLAUDE.md`. When your
`keys.json` or `settings.json` is different, it keeps it as `<name>.bak`. If Claude Code
doesn't trust `~/.herdr/worktrees` yet (where New work makes worktrees), it offers to open
Claude there so you answer its "trust this folder?" once for all of them. It is safe to run
again: it does not change an existing `lasso.json` or `.git`.

If you have a slash command for tickets and PRs, set `prompts` in `lasso.json` (see below).
When you change lasso on two Macs, run `git pull` before you edit.

## lasso.json

All keys are optional. See `lasso.example.json`.

| Key | What it does |
|---|---|
| `workRoot` | The folder that holds your repos (at depth 1 or 2). New work finds repos here, and `--repo home` opens a tab here. Without it, give a repo as a folder path. |
| `repoAliases` | Short names for long repo names in the sidebar: `{ "my-long-service": "svc" }`. |
| `labelRepo` | Linear label → repo. A ticket with one of these labels opens in that repo at once. Other tickets: Claude picks the repo. |
| `prompts` | The task text for a ticket (`implement`) and for a PR link (`review`). `{input}` is the pasted text. Use your own slash command here, for example `"/my-pr {input}"`. |
| `reviewLabel` | The PR label that asks for review. When set, the Context panel says "post for review" until the PR has the label. |

## Herdr updates

`tasks`, `tasks-pane`, `tasks-spaces` and `tasks-tabs` are clones of Herdr's shipped mods
(`agents`, `pane`, `spaces`, `tabs`; see `cloned_from` in each `mod.json`). Herdr never updates
clones, so after a Herdr update:

1. `herdr-mods-sync status`: which clones are behind, and how many lines of each stock file
   are lasso's edits. The sidebar also shows a toast at start when one is behind.
2. `herdr-mods-sync merge`: a three-way merge of the stock changes since `cloned_from` into
   each clone (sources from github.com/herdrdev/herdr-app tags), then bumps `cloned_from`.
   Overlaps are left as conflict markers; nothing is committed. `git checkout mods` undoes it.
3. Resolve, `herdr-app check` each mod, run the tests below, commit.

To keep merges clean, keep a clone's `main.js` as close to stock as you can: put lasso's code
in the mod's own files (`lasso.js`, `work.js`, `board.js`) and call it from one-line hooks.
Turn stock code off with a guard or a removed call instead of deleting it.

## Test

- `node mods/context/links.check.mjs`: the Context panel rules.
- `herdr-new-work-test`: the New work flow, end to end, against two temp repos. Herdr must be
  running.
- `herdr-app check ~/.config/herdr-app/mods/<name>`: Herdr loads and renders one mod.
