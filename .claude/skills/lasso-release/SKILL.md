---
name: lasso-release
description: Cut a lasso release. Rewrites release-please's open release PR into readable notes (a few highlights, then every change grouped by area), then merges it so the tag, CHANGELOG.md and GitHub Release go out. Use when the user says "release lasso", "cut a release", "/lasso-release" or asks for lasso's release notes.
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
### Highlights
- **<Bold short claim.>** One or two plain sentences: what changed for the person and why it matters.
(3 to 5 of these, picked by impact on the person, not by commit count)

### Features
- <Area>: <what it does now>
### Fixes
- <Area>: <what is fixed>

<details><summary>All commits</summary>

- <sha> <subject>
</details>
```

- Areas: Install, Updates, Context panel, New work, Sidebar, Work board, Tour, Agents, Usage footer. Sort lines by area.
- Merge commits that tweak the same thing into one line (ten commits on a pill's color: one line).
- Drop commits that only undo or redo something inside this release, and README-only commits.
- Short, plain English, no em-dashes, no internal names a user never sees (`lasso-data`, `herdr-conf`), no ticket IDs.
- Never name people, companies or private repos: the repo is public.
