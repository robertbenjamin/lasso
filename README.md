<div align="center">

```
╦  ┌─┐┌─┐┌─┐┌─┐
║  ├─┤└─┐└─┐│ │
╩═╝┴ ┴└─┘└─┘└─┘
```

**Run a whole team of Claude Code agents from one Herdr window.**

Paste a ticket, get an agent in its own worktree. Agents start helpers, read their screens and
talk back. A sidebar and a board show who is working, who is blocked and which PR is waiting.

</div>

---

## ⚡ Install

**You need these first:**

| What                      | Get it                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| 🍎 macOS with Homebrew    | [brew.sh](https://brew.sh)                                           |
| 🐑 Herdr 0.1.16 or later  | Install it, then **start it once** (it makes `~/.config/herdr-app`)  |
| 🤖 Claude Code, logged in | `curl -fsSL https://claude.ai/install.sh \| bash`, then run `claude` |
| 🐙 GitHub CLI, logged in  | `brew install gh && gh auth login`                                   |

**Then run one command:**

```sh
gh repo clone robertbenjamin/lasso /tmp/lasso && /tmp/lasso/install.sh
```

The installer checks everything, offers to install what is missing (`jq`, `gh`), asks for the
folder that holds your repos and wires it all up. Then **restart Herdr** and press **⌘⇧N**.

<details>
<summary>What the installer does, step by step</summary>

1. Checks the tools and the Herdr version. Offers `brew install` for missing ones and
   `gh auth login` when you are logged out.
2. Copies lasso into `~/.config/herdr-app`. Your own `keys.json` and `settings.json` stay as
   `<name>.bak`. It moves the git folder there too, so `git -C ~/.config/herdr-app pull` updates lasso.
3. Writes `lasso.json` with your repos folder (it suggests `~/code`, `~/src`, ... when they exist).
   An existing `lasso.json` is never touched.
4. Links the `herdr-*` scripts into `~/.local/bin` and the agent rules into `~/.claude/rules/`.
5. Installs the `lasso-jump` Claude Code plugin.
6. Offers to trust `~/.herdr/worktrees` in Claude Code once, so new worktrees start without a prompt.

It is safe to run again: `~/.config/herdr-app/install.sh`. Flags: `--work-root DIR` and
`--yes` (ask nothing).

</details>

---

## ✨ What you get

|     |                    |                                                                                                                 |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| 🆕  | **New work** ⌘⇧N   | Paste a Linear ticket, a PR link or a note. Claude starts in a fresh worktree of the right repo.                |
| 🧭  | **Sidebar**        | Agents grouped by kind (Recurring, Ship, Side), with live status and their child agents nested.                 |
| 📋  | **Work board**     | Every task as a card: its PR, review state and branch state at a glance.                                        |
| 🔗  | **Context panel**  | The task's link (a Slack thread gets a short summary), its ticket, PRs and branch. One click jumps to a prompt. |
| 📊  | **Usage footer**   | Your Claude usage for the 5 hour and the weekly window.                                                         |
| 🤝  | **Agent teamwork** | Agents start child agents in split panes and talk to them. See below.                                           |

---

## 🤝 How agents talk to each other

No plugin, no MCP server. Three small pieces:

```
parent agent                              child agent (t7)
────────────                              ────────────────
herdr-child "fix the flaky test"    ──▶   starts in a split pane
hc wait --children all              ◀──   done, or blocked
hc read t7                          ◀──   its screen and history
hc send t7 "also update the docs"   ──▶   typed into its prompt
```

| Piece             | From  | What it does                                                                                                                                                                 |
| ----------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hc`              | Herdr | Every pane is a terminal with an address (`t7`). `send`, `read`, `wait` and `keys` drive it. A child that exits or gets blocked sends its parent a note.                     |
| `herdr-child`     | lasso | Starts Claude as a child of the current agent, places its pane (columns of two on the right) and prints its address. `--worktree <repo> <branch>` gives it its own worktree. |
| `herdr-agents.md` | lasso | Rules every Claude session loads: when to start a child, and how to follow it with `hc`.                                                                                     |

The sidebar mods read the parent links from `hc ls --json`, so children show nested under their parent.
`herdr-worktree-gc` closes a child on its own once its PR is merged, it is idle and its worktree is clean.

### 💬 Prompts that work

You never type `herdr-child` or `hc` yourself. Talk to the parent in plain words, and the rules
in `herdr-agents.md` turn that into commands. These are real prompts from daily use (with names
and tickets taken out).

| Use case                          | Say this to the parent                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 🚢 Ship work across repos         | `make a parent ticket with sub issues for each repo, and make 3 children to implement`                             |
| 🔍 Review and explore in parallel | `start 5 new children reviewing each PR, return all findings in each chat, pareto style`                           |
| ⚡ Quick side tasks               | `side task, read-only, no edits: count the test files per module and report the ones with the fewest. max 5 lines` |
| 🧭 Check in and clean up          | `check the child, are we good to go?` / `mark ready and close child`                                               |
| ↩️ From inside a child            | `send this latest info to the parent and close this child`                                                         |

### 💡 More ideas to try

- **Second opinion:** "when the child's PR is up, start another child to review it and send the findings back to the first one"
- **Try both:** "make 2 children, one tries a fix in the backend, one in the frontend. tell me which is simpler"
- **Test first:** child A writes a failing test, child B makes it pass.
- **Stacked PRs:** child B builds on top of child A's branch.
- **CI watcher:** a cheap Haiku child sends the parent one line when CI turns green or red.
- **Right model per job:** Haiku for counting, Sonnet for routine PRs, Opus for planning.

---

## ⚙️ Your settings: `lasso.json`

All keys are optional. See [`lasso.example.json`](lasso.example.json).

| Key           | What it does                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workRoot`    | The folder that holds your repos (at depth 1 or 2). `--repo home` means this folder. New work also knows `lasso` and every repo Herdr worked in. |
| `repoAliases` | Short names for long repo names in the sidebar: `{ "my-long-service": "svc" }`.                                                                  |
| `labelRepo`   | Linear label → repo. A ticket with one of these labels opens in that repo at once. Other tickets: Claude picks the repo.                         |
| `repoModel`   | Repo folder name → Claude model for New work in that repo: `{ "api": "opus" }`.                                                                  |
| `prompts`     | The task text for a ticket (`implement`) and a PR link (`review`). `{input}` is the pasted text.                                                 |
| `reviewLabel` | The PR label that asks for review. The Context panel says "post for review" until the PR has it.                                                 |
| `ticketWord`  | The word your PR titles use when there is no ticket (for example `TECH`). The board leaves it out.                                               |

**Optional:** a Linear API key in `~/.config/herdr-app/linear-key` (or `$LINEAR_API_KEY`) shows
tickets in the Context panel and picks the repo faster in New work.

> The usage footer reads Claude Code's login from the keychain and calls the endpoint behind
> `/usage`. That endpoint is not documented and can change.

---

## 🗂️ What is in the repo

The repo is `~/.config/herdr-app` itself. Its `.gitignore` lets in only lasso's files.

| Part                      | What it does                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `mods/tasks*`             | The sidebar, the Work board, the tabs and the pane headers.                                                        |
| `mods/new-work`           | The New work dialog (⌘⇧N).                                                                                         |
| `mods/context`            | The Context panel.                                                                                                 |
| `mods/lasso-data`         | The one place that fetches data (PRs, titles, transcripts, worktree cleanup) for the other mods. It draws nothing. |
| `mods/claude-footer`      | The usage footer.                                                                                                  |
| `claude-mods/jump`        | A Claude Code plugin, loaded in every agent: the Context panel jumps to a prompt in one step.                      |
| `bin/herdr-*`             | Helper scripts, linked into your PATH. Each one explains itself with `--help`.                                     |
| `bin/lasso-*`             | Scripts the mods run (transcripts, git state, titles, usage). Not in your PATH.                                    |
| `lib/`                    | Helpers the mods share. `herdr-mods-sync share` copies them into each mod.                                         |
| `bin/lib.zsh`             | What the zsh scripts share: the PATH, `--help` and helpers such as `repo_dir`.                                     |
| `herdr-agents.md`         | The agent rules: how to start child agents and worktrees.                                                          |
| `layouts/main-tasks.json` | The layout.                                                                                                        |

---

## 🛠️ Changing lasso

- **Stock clones.** `tasks`, `tasks-pane`, `tasks-spaces` and `tasks-tabs` are clones of
  Herdr's `agents`, `pane`, `spaces` and `tabs`. Keep each `main.js` close to stock: put
  lasso's code in the mod's other files and call it from one-line hooks.
- **lib/.** Shared helpers, one file per topic. Herdr loads a mod only from its own folder, so
  `herdr-mods-sync share` copies `lib/` into each mod as `mods/<mod>/lib/` (git ignores the
  copies; `install.sh` and `npm test` make them). Edit `lib/`, never a copy.
- **After a Herdr update.** `herdr-mods-sync status` shows which clones are behind.
  `herdr-mods-sync merge` merges the stock changes in and leaves conflicts as markers.
  Nothing is committed, and `git checkout mods` undoes it.

### Test

Node is needed only for these (`npm install` first).

| Command                                           | What it checks                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `herdr-app check ~/.config/herdr-app/mods/<name>` | Herdr loads and renders one mod.                                                                  |
| `npm test`                                        | The Context panel rules and the title rules (every `*.test.mjs`).                                 |
| `npm run lint`                                    | oxlint, with its default rules.                                                                   |
| `npm run fmt:check`                               | oxfmt formatting. `npm run fmt` fixes it. The stock `main.js` files are left as Herdr wrote them. |
| `herdr-new-work-test`                             | The New work flow, end to end. Herdr must be running.                                             |
