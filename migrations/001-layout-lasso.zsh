# The layout file main-tasks.json became lasso.json. Move whoever showed it to the new name.
layout=$(herdr-app status 2>/dev/null | jq -r .layout) || exit 1
[[ -n $layout ]] || exit 1
[[ $layout == (main-tasks|main) ]] || exit 0
herdr-app do layout.switch --name lasso >/dev/null
