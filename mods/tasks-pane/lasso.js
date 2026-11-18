// lasso's additions to the stock `pane` mod, called from one-line hooks in main.js.
import { div } from "gpui-kit";
import { shared } from "herdr";
export { tintOf } from "./lib/shared.js";

// A child agent shows its own label, never its parent tab's title.
export function taskLabel(pane) {
  if (!pane.program?.agent) return null;
  const kids = shared("task.child") ?? {};
  return pane.terminal in kids
    ? kids[pane.terminal] || null
    : (shared("task.short") ?? {})[pane.tab];
}

export const taskChip = (task, t) =>
  div().flex_none().truncate().max_w(260).text_color(t.muted).child(`· ${task}`);

// No working arc in the pane header (the tab and the sidebar have it).
export const breathing = (_id, _working, pic) => pic;
