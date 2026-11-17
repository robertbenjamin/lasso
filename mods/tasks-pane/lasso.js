// lasso's additions to the shipped `pane` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";

// An agent pane's short task title (published by mods/tasks as shared "task.short").
// A child agent shows its own label ("task.child"), never its parent tab's title.
export function taskLabel(p) {
  if (!p.program?.agent) return null;
  const kids = shared("task.child") ?? {};
  return p.terminal in kids ? kids[p.terminal] || null : (shared("task.short") ?? {})[p.tab];
}

export const taskChip = (task, t) => div().flex_none().truncate().max_w(260).text_color(t.muted).child(`· ${task}`);

// A halo in the working color breathes behind the program icon while the agent works, as on
// agent rows (mods/tasks/look.js), instead of the stock spinner. The icon stays crisp. No icon:
// a dot. A native loop stays on its element, so the halo is drawn only while working. Mods can't
// import each other: tasks-tabs and tasks-pane each keep this copy.
const HALO = { period: 2400, easing: "ease-in-out" };
export const breathing = (id, working, pic, t) => {
  if (!working) return pic;
  return h_flex().relative().size(14).flex_none().items_center().justify_center()
    .child(h_flex().absolute().left(-4).top(-4).size(22).items_center().justify_center()
      .child(div().id(`${id}-halo`).flex_none().rounded_full().bg(t.working)
        .loop("width", { from: 8, to: 22, ...HALO }).loop("height", { from: 8, to: 22, ...HALO })
        .loop("opacity", { from: 0.06, to: 0.34, ...HALO })))
    .child(pic ?? div().size(7).rounded(4).bg(t.working));
};
