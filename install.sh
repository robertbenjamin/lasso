#!/bin/zsh
# install.sh: puts lasso into Herdr's config folder (~/.config/herdr-app) and links the
# helper scripts into ~/.local/bin. Run it from a clone of this repo, after you start Herdr
# once. Your own keys.json and settings.json are kept as <name>.bak when they differ.
emulate -L zsh
setopt err_exit
SRC=${0:A:h} APP=~/.config/herdr-app
missing=()
for c in herdr-app hc claude gh git python3 curl; do command -v $c >/dev/null || missing+=$c; done
(( $#missing )) && print -u2 "Missing: $missing. Install them first (herdr-app and hc come with Herdr)." && exit 1
gh auth status >/dev/null 2>&1 || print -u2 "Note: gh is not logged in. The PR features stay empty until you run 'gh auth login'."
[[ -d $APP ]] || { print -u2 "No $APP: start Herdr once first."; exit 1; }
[[ $SRC == $APP ]] || git -C $SRC ls-files | while read -r f; do
  [[ -f $APP/$f ]] && ! cmp -s $SRC/$f $APP/$f && [[ $f == (keys|settings).json ]] && cp $APP/$f $APP/$f.bak
  mkdir -p $APP/${f:h} && cp -p $SRC/$f $APP/$f
done
[[ -f $APP/lasso.json ]] || cp $APP/lasso.example.json $APP/lasso.json
mkdir -p ~/.local/bin
for f in $APP/bin/herdr-*; do ln -sf $f ~/.local/bin/; done
print "Done. Next:"
print "  1. Edit $APP/lasso.json: set workRoot to the folder that holds your repos."
print "  2. Add @$APP/herdr-agents.md to ~/.claude/CLAUDE.md."
print "  3. Make sure ~/.local/bin is in your PATH."
