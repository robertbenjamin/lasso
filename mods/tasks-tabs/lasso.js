// lasso's additions to the shipped `tabs` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
// lasso also leaves out the stock per-space panel memory: main.js doesn't call syncPanel.
import { div, svg } from "gpui-kit";
import { shared, openOverlay, run } from "herdr";

// The tab's short task title, published by the tasks mod (mods can't import each other's files).
export const tabName = (c, name) => (shared("task.short") ?? {})[c.id] ?? name;

// Right-click: the tasks mod's kind menu (ship / loop / side), not the stock tab menu.
export const tabMenu = (c, space) =>
  openOverlay({ mod: "tasks", kind: "popup", width: 200, height: 236, at: "pointer", props: { kindMenu: c.id, tabSpace: space.id } });

// Every tab keeps the close button's space, so selecting one doesn't change its width;
// only the active tab shows it (and only it can be clicked).
export const closeButton = (c, t, stop) => div().id(`close-${c.id}`).flex_none().text_color(t.dim)
  .when(!c.active, el => el.invisible())
  .when(c.active, el => el.on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }))
  .child(svg("mods/pane/close.svg").size(12));

// The Context panel (mods/context) is always on, between Files and Changes.
export const contextButton = (panelButton) => panelButton("context", "Context", "mods/context/context.svg");

// The program icon breathes while the agent works, as agent rows do (mods/tasks/look.js), instead
// of the stock spinner. No icon: a dot breathes. A native loop stays on its element, so working
// and resting are separate elements (ids). Mods can't import each other: tasks-tabs and
// tasks-pane each keep this copy.
export const breathing = (id, working, pic, t) => {
  if (!working) return pic;
  return div().id(`${id}-breathing`).flex_none().loop("opacity", { from: 0.4, to: 1, period: 2100, easing: "ease-in-out" })
    .child(pic ?? div().size(7).rounded(4).bg(t.working));
};
