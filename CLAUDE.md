# lasso

**Principles, for every change:**

- **Generic.** It works for anyone who installs lasso, on any machine. No personal paths,
  repos, tools, accounts or team setup in code, comments, tests or docs. Personal values go in
  `lasso.json`.
- **Close to Herdr.** Stay on Herdr's documented API and keep clone edits to one-line hooks
  (below), so a Herdr update merges cleanly.
- **Simple.** The smallest clean change. One way to do each thing. No hacks or workarounds:
  fix the cause, or ask. Each mod, script and `lib/` file does one job.

**Where rules go:**

| Rule | File |
|---|---|
| How to change lasso (for everyone) | this file |
| How agents use Herdr at runtime (children, spaces, worktrees) | `herdr-agents.md` |
| One person's own setup or habits | `CLAUDE.local.md` (git ignores it) |
| Never | the person's global `~/.claude/CLAUDE.md` |

lasso sits on top of Herdr. Keep it separate from Herdr's own code:

- **Stock clones** (`tasks`, `tasks-pane`, `tasks-spaces`, `tasks-tabs`): change `main.js`
  only through one-line hooks into the mod's other files. Turn stock code off with a guard or
  a removed call, never by deleting it. `herdr-mods-sync status` counts lasso's lines in each
  clone: keep that low.
- **Shared code:** mods cannot import each other. Put shared helpers in `lib/` (one file per
  topic, re-exported by `lib/shared.js`), then run `herdr-mods-sync share`. It copies `lib/`
  into each mod as `mods/<mod>/lib/`, which git ignores: never edit a copy.
- **Shared data:** only `mods/lasso-data` fetches and writes the `task.*` shared state. The
  other mods read it.
- **Herdr itself:** use only the documented API (`AGENTS.md`, `hc`, `herdr-app do`).
- **New behavior:** prefer a new mod or script over editing a clone.
- **Comments:** only what the code can't say: a reason, a gotcha, a magic number. One or two
  lines. Prefer a clear name over a comment.
- **Names:** one-letter names only in one-line callbacks. `t` (theme), `cx` and `el` are
  Herdr's own names and stay.

**Breaking changes:** a change that breaks an existing install (a rename, a moved setting)
ships a migration in `migrations/` in the same commit. See README.md, "Changing lasso".

After a change, run the checks in README.md, "Test".

**Committing:**

- Conventional Commits, `feat:` or `fix:` only, with no ticket: release-please cuts a release
  only for those.
- Keep lasso generic: personal values go in `lasso.json`, never in code, comments or tests.
- The `.gitignore` lets in only listed files. For a new mod or layout, add its `!mods/<name>/`
  or `!layouts/<name>.json` line first, or git ignores it.
- Never commit `lasso.json`, `linear-key`, `shared.json`, `view.json`, `data/` or `*.d.ts`.
- A new `herdr-*` script goes in `bin/`, with a symlink from `~/.local/bin`.
