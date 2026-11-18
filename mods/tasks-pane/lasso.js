// lasso's additions to the stock `pane` mod: main.js calls these from one-line hooks.
import { div } from "gpui-kit";
import { shared } from "herdr";
export { tintOf } from "./shared.js";

// An agent pane's short task title, from the tasks mod. A child agent shows its own label,
// never its parent tab's title.
export function taskLabel(p) {
  if (!p.program?.agent) return null;
  const kids = shared("task.child") ?? {};
  return p.terminal in kids ? kids[p.terminal] || null : (shared("task.short") ?? {})[p.tab];
}

export const taskChip = (task, t) =>
  div().flex_none().truncate().max_w(260).text_color(t.muted).child(`· ${task}`);

// The pane header shows the program's icon only: no working arc here (the tab and the sidebar
// have it). main.js still calls this hook, in place of the stock spinner.
export const breathing = (_id, _working, pic) => pic;
