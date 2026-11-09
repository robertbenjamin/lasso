# lasso

A Herdr setup for running many Claude Code agents at once: a custom layout, mods, keys and
helper scripts. The repo is `~/.config/herdr-app` itself. The `.gitignore` lets in only the
files lasso adds. Stock mods, Herdr state (`shared.json`, `view.json`, `data/`) and your own
files (`lasso.json`, `linear-key`) stay out.

## Contents

- `layouts/main-tasks.json`: the main layout.
- `mods/tasks*`: the sidebar (Recurring, Ship, Side), the Work board, the tabs and the panes.
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

1. Install Herdr and start it once.
2. Run `git clone https://github.com/<owner>/lasso /tmp/lasso`.
3. Run `/tmp/lasso/install.sh`. When your `keys.json` or `settings.json` is different, the
   script keeps it as `<name>.bak`.
4. Edit `~/.config/herdr-app/lasso.json` (see below).
5. Add `@~/.config/herdr-app/herdr-agents.md` to `~/.claude/CLAUDE.md`.

To track the repo in place (to commit your own changes), move the clone's `.git` into
`~/.config/herdr-app` after step 3.

### A second Mac, step by step

1. Run `xcode-select --install` (for `git`, `python3` and `curl`).
2. Install Claude Code and log in.
3. Run `brew install gh`, then `gh auth login` with the account that can read lasso.
4. Install Herdr and start it once.
5. Run `gh repo clone <owner>/lasso /tmp/lasso`.
6. Run `/tmp/lasso/install.sh`.
7. To commit from this Mac, run `mv /tmp/lasso/.git ~/.config/herdr-app/`.
8. Put `~/.local/bin` in your PATH (fish: `fish_add_path ~/.local/bin`).
9. Edit `~/.config/herdr-app/lasso.json`. A minimal file: `{ "workRoot": "~/code" }`.
10. Leave out `prompts` when the slash command from your other Mac is not on this Mac.
11. Add `@~/.config/herdr-app/herdr-agents.md` to `~/.claude/CLAUDE.md`.
12. Restart Herdr. Then run `herdr-app status`: its `errors` list must be empty.
13. Run `herdr-new-work-test` to test the New work flow.

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

## Test

- `node mods/context/links.check.mjs`: the Context panel rules.
- `herdr-new-work-test`: the New work flow, end to end, against two temp repos. Herdr must be
  running.
- `herdr-app check ~/.config/herdr-app/mods/<name>`: Herdr loads and renders one mod.
