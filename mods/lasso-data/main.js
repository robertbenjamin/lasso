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
import { bin } from "./lib/shared.js";
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

    // Each job is a loop that awaits its run before it sleeps, so a slow run never overlaps
    // the next one.

    // PRs first: a tab with a PR uses its title, so it needs no title call.
    cx.spawn(async (cx) => {
      await refreshPrs();
      for (;;) {
        await refreshTitles().catch(() => null);
        await cx.sleep(10000);
      }
    });

    // Every 15 s, or at once when the board's refresh button asks.
    cx.spawn(async (cx) => {
      let asked = shared("task.refreshPrs") ?? 0;
      let fetchedAt = Date.now();
      for (;;) {
        await cx.sleep(500);
        const nowAsked = shared("task.refreshPrs") ?? 0;
        if (nowAsked === asked && Date.now() - fetchedAt < 15000) continue;
        asked = nowAsked;
        fetchedAt = Date.now();
        await refreshPrs();
      }
    });

    cx.spawn(async (cx) => {
      for (;;) {
        await refreshSessionPrs().catch(() => null);
        await cx.sleep(MINUTE);
      }
    });

    // Logs to ~/.herdr/worktree-gc.log.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(5 * MINUTE);
        await exec(bin("herdr-worktree-gc")).catch(() => null);
      }
    });
  }

  render() {
    return div();
  }
}
