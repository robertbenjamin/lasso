// lasso's data: the one place that fetches and writes the shared `task.*` state. Every other
// mod only reads it. Herdr runs mod code only inside a view, so this mod sits in an invisible
// block of the layout.
//
// Shared state this mod writes, besides prs.js, sessions.js and titles.js:
//   task.runs  { [tabId]: [workingSince, ...] }  when each tab's agents started working
// It reads:
//   task.refreshPrs  a time: fetch the PRs now (the board's refresh button)

import { View, div } from "gpui-kit";
import { panes, spaces, shared, setShared, exec, checking, setBadge } from "herdr";
import { bin } from "./shared.js";
import { refreshPrs } from "./prs.js";
import { refreshSessionPrs } from "./sessions.js";
import { refreshTitles } from "./titles.js";

const MINUTE = 60000;

function trackRuns() {
  const runs = shared("task.runs") ?? {};
  let next = null;
  for (const tab of spaces().flatMap((space) => space.tabs)) {
    const since = tab.working_since;
    if (!since || (runs[tab.id] ?? []).includes(since)) continue;
    next ??= { ...runs };
    next[tab.id] = [...(runs[tab.id] ?? []), since].slice(-30);
  }
  if (next) setShared("task.runs", next);
}

function updateBadge(last) {
  const blocked = panes().filter((pane) => pane.status === "blocked").length;
  const text = blocked ? String(blocked) : null;
  if (text !== last) setBadge(text);
  return text;
}

export default class LassoData extends View {
  init(_props, cx) {
    // `herdr-app check` runs init for real: no gh, claude or worktree cleanup from a check.
    if (checking()) return;

    trackRuns();
    cx.timer.every(5000, () => trackRuns());

    let badge;
    cx.timer.every(2000, () => {
      badge = updateBadge(badge);
    });

    let prsAsked = shared("task.refreshPrs") ?? 0;
    cx.timer.every(15000, (cx) => cx.spawn(() => refreshPrs()));
    cx.timer.every(500, (cx) => {
      const asked = shared("task.refreshPrs") ?? 0;
      if (asked === prsAsked) return;
      prsAsked = asked;
      cx.spawn(() => refreshPrs());
    });

    let refreshing = false;
    // PRs first: a tab with a PR uses its title, and titles are the slow part.
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        await refreshPrs();
        await refreshSessionPrs();
        await refreshTitles();
      } finally {
        refreshing = false;
      }
    };
    cx.spawn(refresh);
    cx.timer.every(MINUTE, (cx) => cx.spawn(refresh));

    // Logs to ~/.herdr/worktree-gc.log.
    cx.timer.every(5 * MINUTE, (cx) =>
      cx.spawn(() => exec(bin("herdr-worktree-gc")).catch(() => null)),
    );
  }

  render() {
    return div();
  }
}
