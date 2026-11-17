// lasso's additions to the shipped `pane` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
import { div } from "gpui-kit";
import { shared } from "herdr";

// An agent pane's short task title (published by mods/tasks as shared "task.short").
// A child agent shows its own label ("task.child"), never its parent tab's title.
export function taskLabel(p) {
  if (!p.program?.agent) return null;
  const kids = shared("task.child") ?? {};
  return p.terminal in kids ? kids[p.terminal] || null : (shared("task.short") ?? {})[p.tab];
}

export const taskChip = (task, t) => div().flex_none().truncate().max_w(260).text_color(t.muted).child(`· ${task}`);

// The program icon breathes while the agent works, as agent rows do (mods/tasks/look.js), instead
// of the stock spinner. No icon: a dot breathes. A native loop stays on its element, so working
// and resting are separate elements (ids). Mods can't import each other: tasks-tabs and
// tasks-pane each keep this copy.
export const breathing = (id, working, pic, t) => {
  if (!working) return pic;
  return div().id(`${id}-breathing`).flex_none().loop("opacity", { from: 0.4, to: 1, period: 2100, easing: "ease-in-out" })
    .child(pic ?? div().size(7).rounded(4).bg(t.working));
};
