#!/bin/zsh
# install.sh [--work-root DIR]: puts lasso into Herdr's config folder (~/.config/herdr-app)
# and links the helper scripts into ~/.local/bin. Run it from a clone of this repo, after
# you start Herdr once. Your own keys.json and settings.json are kept as <name>.bak when
# they differ. It also:
#   - moves the clone's .git into the config folder (when it has none), so you can commit there
#   - writes lasso.json with workRoot DIR (when there is no lasso.json yet)
#   - adds the herdr-agents.md import to ~/.claude/CLAUDE.md (once)
emulate -L zsh
setopt err_exit
SRC=${0:A:h} APP=~/.config/herdr-app work=
[[ $1 == --work-root && -n $2 ]] && work=$2
[[ -z $1 || -n $work ]] || { print -u2 "usage: install.sh [--work-root DIR]"; exit 2; }
missing=()
for c in herdr-app hc claude gh git python3 curl; do command -v $c >/dev/null || missing+=$c; done
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
  python3 -c 'import json,sys; print(json.dumps({"workRoot": sys.argv[1]}, indent=2))' $work > $APP/lasso.json
else
  cp $APP/lasso.example.json $APP/lasso.json
fi
mkdir -p ~/.local/bin ~/.claude
for f in $APP/bin/herdr-*; do ln -sf $f ~/.local/bin/; done
import="@~/.config/herdr-app/herdr-agents.md"
grep -qxF $import ~/.claude/CLAUDE.md 2>/dev/null || print -r -- $'\n'"$import" >> ~/.claude/CLAUDE.md
print "Done. Restart Herdr."
$APP/bin/herdr-mods-sync status --quiet >/dev/null 2>&1 || print "Some lasso mods are based on an older Herdr: run herdr-mods-sync merge."
[[ -n $work ]] || print "Then set workRoot in $APP/lasso.json to the folder that holds your repos."
[[ :$PATH: == *:$HOME/.local/bin:* ]] || print "Put ~/.local/bin in your PATH (fish: fish_add_path ~/.local/bin)."
