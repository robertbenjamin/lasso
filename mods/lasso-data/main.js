// lasso's data: the one place that fetches and writes the shared `task.*` state. Every other
// mod only reads it. Herdr runs mod code only inside a view, so this mod sits in an invisible
// block of the layout. Herdr calls render() on every change in the app, so render() reacts at
// once; the loops' timers are only the fallback for what changes outside the app (GitHub).
//
// Shared state this mod writes, besides prs.js, sessions.js and titles.js:
//   task.runs  { [tabId]: [workingSince, ...] }  when each tab's agents started working
// It reads:
//   task.refreshPrs  a time: fetch the PRs now (the board's refresh button)

import { View, div } from "gpui-kit";
import {
  panes,
  spaces,
  terminals,
  shared,
  setShared,
  exec,
  checking,
  setBadge,
  run,
  window,
} from "herdr";
import { bin, worktreeRepo, focusedTerminal } from "./lib/shared.js";
import { refreshPrs } from "./prs.js";
import { refreshSessionPrs } from "./sessions.js";
import { refreshTitles } from "./titles.js";
import { refreshRecaps, refreshLatest } from "./recaps.js";
import { runJobs } from "./jobs.js";

const MINUTE = 60000;
const LATEST_EVERY = 5000; // a transcript read only filters lines: a few ms

// No gh or claude calls while the window is hidden; the next tick catches up.
const shown = () => window()?.visible !== false;

const wake = {}; // job name → wakes that job's loop

// Sleeps `ms`, or less when render() wakes this job.
const nap = (cx, job, ms) =>
  Promise.race([cx.sleep(ms), new Promise((resolve) => (wake[job] = resolve))]);

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

// Herdr names a space after its folder, which for a worktree is the branch. Name it after
// its repo; the sidebar shows the branch after the name. A space you named keeps its name.
function nameWorktreeSpaces() {
  for (const space of spaces()) {
    const repo = worktreeRepo(space.folder);
    if (repo && !space.named && !space.machine) run("space.rename", { id: space.id, name: repo });
  }
}

function updateBadge(last) {
  const blocked = panes().filter((pane) => pane.status === "blocked").length;
  const text = blocked ? String(blocked) : null;
  if (text !== last) setBadge(text);
  return text;
}

export default class LassoData extends View {
  init(_props, cx) {
    this.ready = !checking();
    // `herdr-app check` runs init for real: no gh, claude or worktree cleanup from a check.
    if (!this.ready) return;
    this.asked = shared("task.refreshPrs") ?? 0;
    this.working = new Set();

    // Each job is a loop that awaits its run before it sleeps, so a slow run never overlaps
    // the next one.

    // PRs first: a tab with a PR uses its title, so it needs no title call.
    cx.spawn(async (cx) => {
      await refreshPrs();
      for (;;) {
        if (shown()) {
          await refreshTitles().catch(() => null);
        }
        await nap(cx, "titles", MINUTE);
      }
    });

    cx.spawn(async (cx) => {
      for (;;) {
        if (shown()) await refreshRecaps().catch(() => null);
        await nap(cx, "recaps", MINUTE);
      }
    });

    // A prompt sent mid-turn starts nothing, so while an agent works this looks every few seconds.
    cx.spawn(async (cx) => {
      for (;;) {
        if (shown()) await refreshLatest().catch(() => null);
        const working = terminals().some((terminal) => terminal.status === "working");
        await nap(cx, "latest", working ? LATEST_EVERY : MINUTE);
      }
    });

    cx.spawn(async (cx) => {
      for (;;) {
        await nap(cx, "prs", 15000);
        if (shown()) await refreshPrs();
      }
    });

    cx.spawn(async (cx) => {
      for (;;) {
        if (shown()) await refreshSessionPrs().catch(() => null);
        await nap(cx, "sessionPrs", MINUTE);
      }
    });

    // New work: ⌘⇧N queues a job, this starts it within a quarter second.
    const running = new Set();
    cx.timer.every(250, (cx) => runJobs(running, cx));

    // Logs to ~/.herdr/worktree-gc.log.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(5 * MINUTE);
        await exec(bin("herdr-worktree-gc")).catch(() => null);
      }
    });

    // Auto update (bin/lasso-pull): when Herdr starts, then every hour.
    cx.spawn(async (cx) => {
      for (;;) {
        await exec(bin("lasso-pull")).catch(() => null);
        await cx.sleep(60 * MINUTE);
      }
    });
  }

  render() {
    if (!this.ready) return div();
    trackRuns();
    nameWorktreeSpaces();
    this.badge = updateBadge(this.badge);

    const asked = shared("task.refreshPrs") ?? 0;
    if (asked !== this.asked) {
      this.asked = asked;
      wake.prs?.();
    }

    // An agent that stops working has finished a turn: it may have a title or a new PR.
    const working = new Set(
      terminals()
        .filter((terminal) => terminal.status === "working")
        .map((terminal) => terminal.address),
    );
    // One that starts working got a prompt: the Context panel shows it at once.
    if ([...working].some((address) => !this.working.has(address))) wake.latest?.();
    if ([...this.working].some((address) => !working.has(address))) {
      wake.titles?.();
      wake.recaps?.();
      wake.prs?.();
      wake.sessionPrs?.();
    }
    this.working = working;

    // A newly focused agent may have a stale recap: it gets a new one now.
    const focus = focusedTerminal()?.address;
    if (focus !== this.focus) {
      this.focus = focus;
      wake.recaps?.();
    }

    // Back from hidden: what was skipped while hidden runs now, not on the next tick.
    const visible = shown();
    if (visible && this.visible === false) for (const job of Object.values(wake)) job?.();
    this.visible = visible;
    return div();
  }
}
