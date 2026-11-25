# Sourced by lasso's zsh scripts, after `emulate -L zsh` and their setopt line: the PATH, -h/--help
# and the helpers more than one script needs. It sees the script's own arguments.

LASSO_BIN=${ZSH_ARGZERO:A:h}
# Herdr starts the mods' scripts with a short PATH: add Homebrew's and lasso's own.
export PATH=$LASSO_BIN:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH

lasso_help() {
  local line
  for line in "${(@f)$(<$ZSH_ARGZERO)}"; do
    [[ $line == '#!'* ]] && continue
    [[ $line == '#'* ]] || break
    print -r -- "${${line#\#}# }"
  done
}
if [[ $1 == (-h|--help) ]]; then lasso_help; exit 0; fi

# How lasso starts an agent. The jump mod (bin/lasso-reveal) comes from the lasso marketplace
# in ~/.claude/settings.json, so it loads however the agent starts, restarts included.
# LASSO_AGENT: a program that takes claude's arguments, to run in its place (the tour's
# scripted agent, bin/lasso-tour-agent).
LASSO_CLAUDE=(${LASSO_AGENT:-claude} --permission-mode auto)

usage_error() { print -u2 -r -- "${ZSH_ARGZERO:t}: $* (see --help)"; exit 2; }

# A folder, or a repo name: in workRoot (lasso.json) at depth 1 or 2, "lasso" (this app
# folder), or a repo Herdr has worked in (known_repos). Nothing when there is none.
repo_dir() {
  [[ -d $1 ]] && { print -r -- ${1:A}; return 0; }
  local work=$(herdr-conf workRoot) m
  [[ -n $work ]] || return 0
  m=($work/$1/.git(N) $work/*/$1/.git(N))
  if (( $#m )); then print -r -- ${m[1]:h}
  elif [[ $1 == lasso && -e ${LASSO_BIN:h}/.git ]]; then print -r -- ${LASSO_BIN:h}
  else known_repos | awk -F'\t' -v r=$1 '$1 == r { print $2; exit }'; fi
}

# "name<TAB>folder" of each repo Herdr has worked in: the main checkouts of its open and
# recent spaces, and of the worktrees in ~/.herdr/worktrees.
known_repos() {
  local f main
  for f in ${(f)"$(herdr-app ls 2>/dev/null | jq -r '.spaces[].folder, .recent[].folder')"} ~/.herdr/worktrees/*/*(N/); do
    main=$(git -C $f rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
    print -r -- "${main:h:t}	${main:h}"
  done | sort -u
}

# The main checkout of a repo, also when $1 is one of its worktrees.
main_checkout() { print -r -- ${$(git -C $1 rev-parse --path-format=absolute --git-common-dir):h}; }

gh_slug() { git -C $1 remote get-url origin | sed -E 's#^.*github.com[:/]##; s#\.git$##'; }

# LASSO_MODEL (the New work dialog's pick) wins over the repo's repoModel in lasso.json, else Opus.
repo_model() { [[ -n $LASSO_MODEL ]] && print -r -- $LASSO_MODEL || herdr-conf repoModel | awk -F'\t' -v r=$1 '$1==r{m=$2} END{print m ? m : "opus"}'; }

pane_of() { herdr-app ls | jq -r --arg a $1 '.spaces[].tabs[].terminals[] | select(.terminal == $a) | .pane // empty'; }
