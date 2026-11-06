# lasso

My Herdr setup: the custom layout, mods, keys and helper scripts.
The repo is `~/.config/herdr-app` itself. The `.gitignore` lets in only the files I made.
Stock mods, state (`shared.json`, `view.json`, `data/`) and secrets (`linear-key`) stay out.

## Contents

- `layouts/main-tasks.json`: the main layout.
- `mods/tasks*`: the sidebar (Recurring, Ship, Side), the Work board, the tabs and the panes.
- `mods/new-work`, `mods/claude-footer`: the New work menu and the Claude usage footer.
- `bin/herdr-*`: the helper scripts (`herdr-child`, `herdr-worktree`, ...).

## Set up on a new Mac

1. Install Herdr and start it once.
2. Run `git clone https://github.com/robertbenjamin/lasso /tmp/lasso`.
3. Run `mv /tmp/lasso/.git ~/.config/herdr-app/ && git -C ~/.config/herdr-app checkout -- .`.
4. Run `for f in ~/.config/herdr-app/bin/*; do ln -sf "$f" ~/.local/bin/; done`.
