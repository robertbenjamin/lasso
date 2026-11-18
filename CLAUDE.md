# lasso

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

After a change, run the checks in README.md, "Test".
