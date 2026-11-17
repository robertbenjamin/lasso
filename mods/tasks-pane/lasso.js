// lasso's additions to the stock `pane` mod: main.js calls these from one-line hooks.
import { div } from "gpui-kit";
import { shared } from "herdr";
export { breathing, tintOf } from "./shared.js";

// An agent pane's short task title, from the tasks mod. A child agent shows its own label,
// never its parent tab's title.
export function taskLabel(p) {
  if (!p.program?.agent) return null;
  const kids = shared("task.child") ?? {};
  return p.terminal in kids ? kids[p.terminal] || null : (shared("task.short") ?? {})[p.tab];
}

export const taskChip = (task, t) => div().flex_none().truncate().max_w(260).text_color(t.muted).child(`· ${task}`);
