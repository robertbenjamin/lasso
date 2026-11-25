#!/bin/zsh
# install.sh [--work-root DIR] [--yes]: puts lasso into Herdr's config folder (~/.config/herdr-app)
# and links the helper scripts into ~/.local/bin. Run it from a clone of this repo, after you
# start Herdr once. Safe to run again. Your own keys.json and settings.json are kept as
# <name>.bak when they differ. It also:
#   - moves the clone's .git into the config folder (when it has none), so `git pull` updates lasso
#   - writes lasso.json with workRoot DIR (when there is no lasso.json yet). Without
#     --work-root it asks, and suggests a folder it finds (~/code, ~/src, ...)
#   - links herdr-agents.md into ~/.claude/rules/, so Claude Code loads it in every session
#   - installs the lasso-jump Claude Code plugin
# --yes: ask nothing, take the defaults.
emulate -L zsh
setopt err_exit
autoload -Uz is-at-least
SRC=${0:A:h} APP=~/.config/herdr-app work= yes=
while (( $# )); do
  case $1 in
    --work-root) [[ -n $2 ]] || { print -u2 "install.sh: --work-root needs a folder"; exit 2; }; work=${~2}; shift 2 ;;
    --yes|-y) yes=1; shift ;;
    -h|--help) sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p;}' $0; exit 0 ;;
    *) print -u2 "usage: install.sh [--work-root DIR] [--yes]"; exit 2 ;;
  esac
done
[[ -t 0 && -z $yes ]] && ask=1 || ask=

if [[ -t 1 ]]; then B=$'\e[1m' D=$'\e[2m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' C=$'\e[36m' N=$'\e[0m'
else B= D= G= Y= R= C= N=; fi
step() { print "\n${B}${C}▸${N} ${B}$*${N}"; }
ok()   { print "  ${G}✓${N} $*"; }
warn() { print "  ${Y}!${N} $*"; notes+=("$*"); }
fail() { print "  ${R}✗${N} $*"; }
notes=()
home() { print -r -- ${1/#$HOME/\~}; }

print "${B}"
print '  ╦  ┌─┐┌─┐┌─┐┌─┐'
print '  ║  ├─┤└─┐└─┐│ │'
print '  ╩═╝┴ ┴└─┘└─┘└─┘'
print "${N}${D}  many Claude Code agents, one Herdr window${N}"

step "Checking what lasso needs"
# tool, what it is for, how to get it. herdr-app and hc come with Herdr.
need=(
  herdr-app 'the Herdr app'                  'download Herdr, then start it once'
  hc        'Herdr terminals'                'comes with Herdr'
  claude    'Claude Code'                    'curl -fsSL https://claude.ai/install.sh | bash'
  gh        'GitHub CLI (PRs)'               'brew install gh'
  jq        'JSON for the scripts'           'brew install jq'
  git       'version control'                'xcode-select --install'
  curl      'downloads'                      'xcode-select --install'
)
missing=()
for c what fix in $need; do
  if command -v $c >/dev/null; then ok "${(r:10:)c}${D}$what${N}"
  else fail "${(r:10:)c}${D}$what. Get it: ${N}$fix"; missing+=($c); fi
done
brew_tools=(gh jq)
brewable=(${missing:*brew_tools})
if (( $#brewable )) && command -v brew >/dev/null && [[ -n $ask ]] \
    && read -q "?  Install $brewable with Homebrew now? [y/N] "; then
  print; brew install $brewable && missing=(${missing:|brewable})
fi
if (( $#missing )); then
  print "\n${R}Install ${B}$missing${N}${R}, then run install.sh again.${N}"; exit 1
fi
herdr_version=$(herdr-app --version 2>/dev/null | awk '{print $2}')
if [[ -n $herdr_version ]] && ! is-at-least 0.1.18 $herdr_version; then
  fail "Herdr $herdr_version is too old: lasso needs 0.1.18 or later"; exit 1
fi
[[ -d $APP ]] || { fail "No $(home $APP): start Herdr once, then run install.sh again"; exit 1; }
ok "Herdr ${herdr_version:-(version unknown)}"
if ! gh auth status >/dev/null 2>&1 && [[ -n $ask ]] && read -q "?  gh is not logged in. Log in now? [y/N] "; then
  print; gh auth login || true
fi
if gh auth status >/dev/null 2>&1; then ok "gh is logged in"
else warn "gh is not logged in: PRs stay empty until you run ${B}gh auth login${N}"; fi

step "Copying lasso into $(home $APP)"
if [[ $SRC != ${APP:A} ]]; then
  git -C $SRC ls-files | while read -r f; do
    if [[ -f $APP/$f && $f == (keys|settings).json ]] && ! cmp -s $SRC/$f $APP/$f; then
      cp $APP/$f $APP/$f.bak
      ok "kept your $f as $f.bak"
    fi
    mkdir -p $APP/${f:h} && cp -p $SRC/$f $APP/$f
  done
  ok "mods, layout, keys and scripts"
  if [[ ! -e $APP/.git ]]; then
    mv $SRC/.git $APP/.git
    ok "moved .git here: ${B}git -C $(home $APP) pull${N} updates lasso"
  fi
else
  ok "already running from $APP"
fi

step "Your settings (lasso.json)"
if [[ -f $APP/lasso.json ]]; then
  ok "kept your lasso.json"
  [[ -z $work ]] || warn "lasso.json exists, so --work-root changed nothing"
else
  if [[ -z $work ]]; then
    guess=
    for d in ~/code ~/src ~/dev ~/Developer ~/Projects ~/projects ~/git; do [[ -d $d ]] && { guess=$d; break; }; done
    if [[ -n $ask ]]; then
      print "  Which folder holds your repos? ${D}(New work finds repos there, 1 or 2 levels deep)${N}"
      vared -p "  ${C}›${N} " -c guess
      work=${~guess}
    else
      work=$guess
    fi
  fi
  if [[ -n $work ]]; then
    [[ -d $work ]] || warn "$work does not exist yet"
    jq -n --arg dir ${work/#$HOME/\~} '{workRoot: $dir}' > $APP/lasso.json
    ok "workRoot: $(home $work)"
  else
    cp $APP/lasso.example.json $APP/lasso.json
    warn "set ${B}workRoot${N} in $(home $APP)/lasso.json to the folder that holds your repos"
  fi
fi

step "Wiring it up"
# Each mod gets its copy of lib/ (Herdr loads a mod only from its own folder).
$APP/bin/herdr-mods-sync share >/dev/null
# .githooks re-copies lib/ after a pull or checkout.
git -C $APP config core.hooksPath .githooks
ok "shared helpers copied into each mod"
$APP/bin/lasso-update || true
mkdir -p ~/.local/bin ~/.claude/rules
for f in $APP/bin/herdr-*; do ln -sf $f ~/.local/bin/; done
ok "helper scripts linked into ~/.local/bin ${D}(herdr-child, herdr-open-work, ...)${N}"
# A user rule without `paths` loads at launch like ~/.claude/CLAUDE.md, and keeps that file yours.
ln -sf $APP/herdr-agents.md ~/.claude/rules/herdr-agents.md
ok "agent rules linked into ~/.claude/rules ${D}(how agents start and talk to child agents)${N}"
# The jump mod is a Claude Code plugin from the lasso marketplace in the config folder. Settings
# load it in every session, so a restarted agent keeps it (a flag would not survive a restart).
claude plugin marketplace add $APP >/dev/null 2>&1 || true
if claude plugin install lasso-jump@lasso >/dev/null 2>&1; then ok "Claude Code plugin lasso-jump"
else warn "could not install the lasso-jump plugin: run ${B}claude plugin install lasso-jump@lasso${N}"; fi

# New work makes worktrees in ~/.herdr/worktrees, outside your repos, and Claude Code asks
# "trust this folder?" in each new folder (it trusts a folder with everything under it). You
# answer that once here, for all of them. Only reads ~/.claude.json; Claude saves your answer.
wt=~/.herdr/worktrees
mkdir -p $wt
if jq -e --arg dir $wt/ '.projects // {} | to_entries
    | any(.key as $project | .value.hasTrustDialogAccepted and ($dir | startswith($project + "/")))' ~/.claude.json >/dev/null 2>&1; then
  ok "Claude Code trusts $(home $wt)"
elif [[ -n $ask ]]; then
  print "  New work puts worktrees in $(home $wt). Claude Code asks ${B}\"trust this folder?\"${N} in each new"
  print "  one, unless you trust the parent folder once."
  if read -q "?  Open Claude there now to answer Yes once? [y/N] "; then
    print "\n  Choose ${B}Yes, I trust this folder${N}, then quit Claude (ctrl+c twice)."
    (cd $wt && claude) || true
  else
    print
    warn "trust worktrees later: ${B}cd $(home $wt) && claude${N}, choose Yes, quit"
  fi
else
  warn "trust worktrees once: ${B}cd $(home $wt) && claude${N}, choose Yes, quit"
fi

$APP/bin/herdr-mods-sync status --quiet >/dev/null 2>&1 \
  || warn "some lasso mods are based on an older Herdr: run ${B}herdr-mods-sync merge${N}"
[[ :$PATH: == *:$HOME/.local/bin:* ]] \
  || warn "put ~/.local/bin in your PATH ${D}(fish: fish_add_path ~/.local/bin, zsh: add it in ~/.zshrc)${N}"

print "\n${G}${B}✓ lasso is installed.${N}"
(( $#notes )) && { print "\n${Y}${B}To do:${N}"; for n in $notes; print "  • $n"; }
print "\n${B}Next:${N}"
print "  1. Restart Herdr. ${D}herdr-app status${N} should show ${D}\"errors\": []${N}"
print "  2. Take the 90-second tour that opens ${D}(again later: herdr-app do mod.open --name tour)${N}"
print "  3. Press ${B}⌘⇧N${N}, paste a ticket, PR link or note, and watch an agent start"
print "  4. Optional: run ${D}herdr-new-work-test${N} to check the New work flow end to end"
