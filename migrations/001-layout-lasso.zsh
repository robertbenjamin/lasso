# main-tasks.json became lasso.json. Herdr falls back to main when a layout's file is gone.
layout=$(herdr-app status 2>/dev/null | jq -r .layout) || exit 1
[[ -n $layout ]] || exit 1
[[ $layout == (main-tasks|main) ]] || exit 0
herdr-app do layout.switch --name lasso >/dev/null
