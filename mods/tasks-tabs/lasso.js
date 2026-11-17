// lasso's additions to the stock `tabs` mod: main.js calls these from one-line hooks.
// lasso also drops the stock per-space panel memory (main.js doesn't call syncPanel).
import { div, svg } from "gpui-kit";
import { shared, openOverlay, run } from "herdr";
export { breathing, tintOf } from "./shared.js";

// The tab's short task title, from the tasks mod.
export const tabName = (c, name) => (shared("task.short") ?? {})[c.id] ?? name;

// Right-click: the tasks mod's kind menu with the tab items. A popup needs its height up
// front: 236 is menuHeight() in mods/tasks/work.js for those 7 entries.
export const tabMenu = (c, space) =>
  openOverlay({ mod: "tasks", kind: "popup", width: 200, height: 236, at: "pointer", props: { kindMenu: c.id, tabSpace: space.id } });

// Every tab reserves the close button's space; only the active tab shows it.
export const closeButton = (c, t, stop) => div().id(`close-${c.id}`).flex_none().text_color(t.dim)
  .when(!c.active, el => el.invisible())
  .when(c.active, el => el.on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }))
  .child(svg("mods/pane/close.svg").size(12));

export const contextButton = (panelButton) => panelButton("context", "Context", "mods/context/context.svg");
