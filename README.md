# lasso

A Herdr setup for running many Claude Code agents at once: a layout, mods, keys and helper
scripts. The repo is `~/.config/herdr-app` itself. Its `.gitignore` lets in only lasso's files.

## What is in it

| Part | What it does |
|---|---|
| `mods/tasks*` | The sidebar (agents by kind: Recurring, Ship, Side), the Work board, the tabs and the pane headers. |
| `mods/new-work` | The New work dialog (⌘⇧N): paste a ticket, a PR link or a note, and Claude starts in a new worktree. |
| `mods/context` | The Context panel: the focused agent's ticket, its PRs with blockers and checks, its branch state. |
| `mods/claude-footer` | Claude usage (5 hours and week) in the sidebar footer. |
| `bin/herdr-*` | Helper scripts. Each one explains itself in its first lines. |
| `herdr-agents.md` | Instructions for agents: how to start child agents and worktrees. |
| `layouts/main-tasks.json` | The layout. |

## Requirements

- macOS and Herdr 0.1.16 or later.
- `claude` (logged in), `gh` (logged in), `git`, `zsh`, `python3`, `curl`, `jq`.
- Optional: a Linear API key in the file `linear-key` (or `$LINEAR_API_KEY`), for tickets in
  the Context panel and a faster repo pick in New work.

The usage footer reads Claude Code's login from the keychain and calls the endpoint behind
`/usage`. That endpoint is not documented and can change.

## Set up

1. Install Claude Code, `gh` and Herdr. Log in to the first two and start Herdr once.
2. Run this, with the folder that holds your repos:
   ```sh
   gh repo clone <owner>/lasso /tmp/lasso && /tmp/lasso/install.sh --work-root ~/code
   ```
3. Restart Herdr. `herdr-app status` must show an empty `errors` list.
4. Run `herdr-new-work-test`.

`install.sh` is safe to run again. It keeps a different `keys.json` or `settings.json` as
`<name>.bak` and never changes an existing `lasso.json`.

## lasso.json

Your own settings. All keys are optional. See `lasso.example.json`.

| Key | What it does |
|---|---|
| `workRoot` | The folder that holds your repos (at depth 1 or 2). `--repo home` means this folder. |
| `repoAliases` | Short names for long repo names in the sidebar: `{ "my-long-service": "svc" }`. |
| `labelRepo` | Linear label → repo. A ticket with one of these labels opens in that repo at once. Other tickets: Claude picks the repo. |
| `repoModel` | Repo folder name → Claude model for New work in that repo: `{ "api": "opus" }`. |
| `prompts` | The task text for a ticket (`implement`) and a PR link (`review`). `{input}` is the pasted text. |
| `reviewLabel` | The PR label that asks for review. The Context panel says "post for review" until the PR has it. |
| `ticketWord` | The word your PR titles use when there is no ticket (for example `TECH`). The board leaves it out. |

## Changing lasso

- **Stock clones.** `tasks`, `tasks-pane`, `tasks-spaces` and `tasks-tabs` are clones of
  Herdr's `agents`, `pane`, `spaces` and `tabs`. Keep each `main.js` close to stock: put
  lasso's code in the mod's other files and call it from one-line hooks.
- **shared.js.** Herdr loads a mod only from its own folder, so each mod has a copy of
  `mods/tasks/shared.js`. Edit that one, then run `herdr-mods-sync share`.
- **After a Herdr update.** `herdr-mods-sync status` shows which clones are behind.
  `herdr-mods-sync merge` merges the stock changes in and leaves conflicts as markers.
  Nothing is committed, and `git checkout mods` undoes it.

## Test

| Command | What it checks |
|---|---|
| `herdr-app check ~/.config/herdr-app/mods/<name>` | Herdr loads and renders one mod. |
| `node mods/context/links.check.mjs` | The Context panel rules. |
| `node mods/tasks/titles.check.mjs` | The title rules. |
| `herdr-new-work-test` | The New work flow, end to end. Herdr must be running. |
