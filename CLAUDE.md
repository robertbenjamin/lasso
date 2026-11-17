# lasso

lasso sits on top of Herdr. Keep it separate from Herdr's own code:

- **Stock clones** (`tasks`, `tasks-pane`, `tasks-spaces`, `tasks-tabs`): change `main.js`
  only through one-line hooks into the mod's other files. Turn stock code off with a guard or
  a removed call, never by deleting it. `herdr-mods-sync status` counts lasso's lines in each
  clone: keep that low.
- **Shared code:** mods cannot import each other. Put shared helpers in
  `mods/tasks/shared.js`, then run `herdr-mods-sync share`.
- **Herdr itself:** use only the documented API (`AGENTS.md`, `hc`, `herdr-app do`).
- **New behavior:** prefer a new mod or script over editing a clone.
- **Comments:** say why, in one or two lines. Prefer a clear name over a comment.

After a change, run the checks in README.md, "Test".
