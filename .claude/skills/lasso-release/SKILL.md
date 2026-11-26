---
name: lasso-release
description: Cut a lasso release. Rewrites release-please's open release PR into readable notes (a few highlights, then every change, most important first, with an emoji per area), then merges it so the tag, CHANGELOG.md and GitHub Release go out. Use when the user says "release lasso", "cut a release", "/lasso-release" or asks for lasso's release notes.
---

# Cut a lasso release

release-please (`.github/workflows/release-please.yml`) keeps one open PR, titled like
`chore(main): release 0.2.0`, with a raw list of every `feat:`/`fix:` since the last release.
Its notes become the GitHub Release and the `CHANGELOG.md` entry when it merges. This skill
rewrites them into something a person reads, then merges.

## Steps

1. Find the release PR: `gh pr list -R robertbenjamin/lasso --label "autorelease: pending" --json number,title,headRefName,body`.
   None open: say there is nothing to release yet and stop.
2. Read what changed: the PR body, and `git log <last tag>..origin/main --format='%h %s'`
   (last tag: `git describe --tags --abbrev=0 origin/main`; no tag yet: the whole PR body).
3. Write the notes in the format below. Show them to the user and wait for a yes.
4. Put them in both places, then merge at once (release-please rewrites the PR on the next push to main):
   - PR body: `gh pr edit <n> --body-file <notes>`. Keep release-please's first line (`:robot: I have created a release *beep* *boop*`), its `---` lines and its footer; replace only the notes between them.
   - `CHANGELOG.md` on the PR branch: replace the new version's section with the notes (keep its `## [x.y.z](compare link) (date)` heading). Commit with `fix: release notes for x.y.z` and push to the PR branch.
   - `gh pr merge <n> --squash`.
5. Check the Release: `gh release view v<x.y.z> -R robertbenjamin/lasso`. If its body is still the raw list, `gh release edit v<x.y.z> --notes-file <notes>`.
6. Link the user to the Release.

## Notes format

```markdown
### 🚀 Highlights

- <emoji> **<Bold short claim.>** One or two plain sentences: what changed for the person and why it matters.

### ✨ Features

- <emoji> **<Area>:** <what it does now>

### 🐛 Fixes

- <emoji> **<Area>:** <what is fixed>

<details><summary>📜 All commits</summary>

- <sha> <subject>
</details>
```

- **Highlights:** 3 to 5, picked by impact on the person, not by commit count. A highlight
  still gets its line under Features or Fixes.
- **Order, in every section:** most important first. Importance is how much it changes a
  person's day (a new flow or a changed default beats a polish), then how many people hit it,
  then the size of the change (lines changed: `git show --shortstat`). Never sort by area or date.
- **Emojis:** one per line, the area's emoji below, so the same area always looks the same.
  A highlight may use a more fitting one.

| Area | Emoji | Area | Emoji |
|---|---|---|---|
| Install | 📦 | Work board | 🗂️ |
| Updates | 🔄 | Tour | 🎓 |
| Context panel | 🧠 | Agents | 🤖 |
| New work | 🆕 | Usage footer | 📊 |
| Sidebar | 🧭 | Releases | 🏷️ |

- Merge commits that tweak the same thing into one line (ten commits on a pill's color: one line).
- Drop commits that only undo or redo something inside this release, and commits that change
  only README.md or CLAUDE.md (docs for contributors, not for users).
- Short, plain English, no em-dashes, no internal names a user never sees (`lasso-data`, `herdr-conf`), no ticket IDs.
- Never name people, companies or private repos: the repo is public.
