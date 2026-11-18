// lasso's additions to the stock `tabs` mod, called from one-line hooks in main.js.
// main.js doesn't call syncPanel: lasso drops the stock per-space panel memory.
import { div, svg } from "gpui-kit";
import { shared, openOverlay, run } from "herdr";
export { breathing, tintOf } from "./shared.js";

export const tabName = (tab, name) => (shared("task.short") ?? {})[tab.id] ?? name;

// A popup needs its height up front: 236 is menuHeight() in mods/tasks/work.js for these 7
// entries.
export const tabMenu = (tab, space) =>
  openOverlay({
    mod: "tasks",
    kind: "popup",
    width: 200,
    height: 236,
    at: "pointer",
    props: { kindMenu: tab.id, tabSpace: space.id },
  });

export const closeButton = (tab, t, stop) =>
  div()
    .id(`close-${tab.id}`)
    .flex_none()
    .text_color(t.dim)
    .when(!tab.active, (el) => el.invisible())
    .when(tab.active, (el) =>
      el.on_mouse_down("left", stop).on_click((_e, cx) => {
        cx.stop_propagation();
        run("tab.close", { id: tab.id });
      }),
    )
    .child(svg("mods/pane/close.svg").size(12));

export const contextButton = (panelButton) =>
  panelButton("context", "Context", "mods/context/context.svg");
