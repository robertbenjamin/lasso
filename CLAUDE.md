# lasso

## Keep upstream conflicts small

lasso sits on top of Herdr. Keep it separate from Herdr's own code wherever you can:

- **Stock clones** (`tasks`, `tasks-pane`, `tasks-spaces`, `tasks-tabs`): change their
  `main.js` only through one-line hooks into the mod's own files (`lasso.js`, `work.js`,
  `board.js`, `look.js`). Turn stock code off with a guard or a removed call, never by deleting
  it. `herdr-mods-sync status` shows how many lines of each clone are lasso's: keep that low.
- **Herdr core and the app:** use only the documented API (`herdr.d.ts`, `AGENTS.md`, `hc`,
  `herdr-app do`). Don't rely on undocumented fields or behavior.
- **New behavior:** prefer a new lasso mod or script over editing a clone.

Details: README.md, "Herdr updates".
