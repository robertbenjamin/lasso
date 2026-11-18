#!/bin/zsh
# install.sh [--work-root DIR]: puts lasso into Herdr's config folder (~/.config/herdr-app)
# and links the helper scripts into ~/.local/bin. Run it from a clone of this repo, after
# you start Herdr once. Your own keys.json and settings.json are kept as <name>.bak when
# they differ. It also:
#   - moves the clone's .git into the config folder (when it has none), so you can commit there
#   - writes lasso.json with workRoot DIR (when there is no lasso.json yet)
#   - links herdr-agents.md into ~/.claude/rules/, so Claude Code loads it in every session
emulate -L zsh
setopt err_exit
SRC=${0:A:h} APP=~/.config/herdr-app work=
[[ $1 == --work-root && -n $2 ]] && work=$2
[[ -z $1 || -n $work ]] || { print -u2 "usage: install.sh [--work-root DIR]"; exit 2; }
missing=()
for c in herdr-app hc claude gh git curl jq; do command -v $c >/dev/null || missing+=$c; done
(( $#missing )) && print -u2 "Missing: $missing. Install them first (herdr-app and hc come with Herdr)." && exit 1
gh auth status >/dev/null 2>&1 || print -u2 "Note: gh is not logged in. The PR features stay empty until you run 'gh auth login'."
[[ -d $APP ]] || { print -u2 "No $APP: start Herdr once first."; exit 1; }
if [[ $SRC != ${APP:A} ]]; then
  git -C $SRC ls-files | while read -r f; do
    [[ -f $APP/$f ]] && ! cmp -s $SRC/$f $APP/$f && [[ $f == (keys|settings).json ]] && cp $APP/$f $APP/$f.bak
    mkdir -p $APP/${f:h} && cp -p $SRC/$f $APP/$f
  done
  [[ -e $APP/.git ]] || mv $SRC/.git $APP/.git
fi
if [[ -f $APP/lasso.json ]]; then
  [[ -z $work ]] || print -u2 "Note: $APP/lasso.json exists, so --work-root changed nothing."
elif [[ -n $work ]]; then
  jq -n --arg dir $work '{workRoot: $dir}' > $APP/lasso.json
else
  cp $APP/lasso.example.json $APP/lasso.json
fi
# Each mod gets its copy of lib/ (Herdr loads a mod only from its own folder).
$APP/bin/herdr-mods-sync share >/dev/null
mkdir -p ~/.local/bin ~/.claude/rules
for f in $APP/bin/herdr-*; do ln -sf $f ~/.local/bin/; done
# A user rule without `paths` loads at launch like ~/.claude/CLAUDE.md, and keeps that file yours.
ln -sf $APP/herdr-agents.md ~/.claude/rules/herdr-agents.md
# New work makes worktrees in ~/.herdr/worktrees, outside your repos, and Claude Code asks
# "trust this folder?" in each new folder (it trusts a folder with everything under it). You
# answer that once here, for all of them. Only reads ~/.claude.json; Claude saves your answer.
wt=~/.herdr/worktrees
mkdir -p $wt
if ! jq -e --arg dir $wt/ '.projects // {} | to_entries
    | any(.key as $project | .value.hasTrustDialogAccepted and ($dir | startswith($project + "/")))' ~/.claude.json >/dev/null 2>&1; then
  print "\nClaude Code doesn't trust $wt yet. New work makes its worktrees there (checkouts of"
  print "your repos), so Claude would ask \"trust this folder?\" in each new one before it starts."
  if [[ -t 0 ]] && read -q "?Open Claude there now, so you can answer Yes once for all of them? [y/N] "; then
    print "\nChoose \"Yes, I trust this folder\", then quit Claude (ctrl+c twice)."
    (cd $wt && claude) || true
  else
    print "\nTo do it later: cd $wt && claude, choose Yes, then quit."
  fi
fi
print "Done. Restart Herdr."
$APP/bin/herdr-mods-sync status --quiet >/dev/null 2>&1 || print "Some lasso mods are based on an older Herdr: run herdr-mods-sync merge."
[[ -n $work ]] || print "Then set workRoot in $APP/lasso.json to the folder that holds your repos."
[[ :$PATH: == *:$HOME/.local/bin:* ]] || print "Put ~/.local/bin in your PATH (fish: fish_add_path ~/.local/bin)."
