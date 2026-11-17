# Sourced by lasso's zsh scripts, after `emulate -L zsh` and their setopt line: the PATH, -h/--help
# and the helpers more than one script needs. It sees the script's own arguments.

LASSO_BIN=${ZSH_ARGZERO:A:h}
# Herdr starts the mods' scripts with a short PATH: add Homebrew's and lasso's own.
export PATH=$LASSO_BIN:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH

# The script's header comment, without the shebang and the "# " marks.
lasso_help() {
  local line
  for line in "${(@f)$(<$ZSH_ARGZERO)}"; do
    [[ $line == '#!'* ]] && continue
    [[ $line == '#'* ]] || break
    print -r -- "${${line#\#}# }"
  done
}
if [[ $1 == (-h|--help) ]]; then lasso_help; exit 0; fi

# A usage error: the reason and how to get help, exit 2.
usage_error() { print -u2 -r -- "${ZSH_ARGZERO:t}: $* (see --help)"; exit 2; }

# A folder, or a repo name in workRoot (lasso.json) at depth 1 or 2. Prints the folder, or
# nothing when there is none.
repo_dir() {
  [[ -d $1 ]] && { print -r -- ${1:A}; return 0; }
  local work=$(herdr-conf workRoot) m
  [[ -n $work ]] || return 0
  m=($work/$1/.git(N) $work/*/$1/.git(N))
  if (( $#m )); then print -r -- ${m[1]:h}; fi
}

# The main checkout of a repo, also when $1 is one of its worktrees.
main_checkout() { print -r -- ${$(git -C $1 rev-parse --path-format=absolute --git-common-dir):h}; }

# owner/name of a repo's GitHub origin.
gh_slug() { git -C $1 remote get-url origin | sed -E 's#^.*github.com[:/]##; s#\.git$##'; }

# repoModel (lasso.json): the Claude model for a repo folder name, or nothing.
repo_model() { herdr-conf repoModel | awk -F'\t' -v r=$1 '$1==r{print $2}'; }

# The Herdr pane that shows terminal $1, or nothing.
pane_of() { herdr-app ls | jq -r --arg a $1 '.spaces[].tabs[].terminals[] | select(.terminal == $a) | .pane // empty'; }
