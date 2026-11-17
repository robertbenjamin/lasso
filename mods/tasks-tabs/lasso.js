// lasso's additions to the shipped `tabs` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
// lasso also leaves out the stock per-space panel memory: main.js doesn't call syncPanel.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, spaces, openOverlay, run } from "herdr";

// The tab's short task title, published by the tasks mod (mods can't import each other's files).
export const tabName = (c, name) => (shared("task.short") ?? {})[c.id] ?? name;

// Right-click: the tasks mod's kind menu (ship / loop / side), not the stock tab menu. Mods can't
// import each other, so its height is fixed here: menuHeight() in tasks/work.js for the 4 kinds
// and the 3 tab items (236).
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

// The glow's color: the color of the agent's space (its repo's space for a worktree in `cwd`),
// as the theme draws it. ponytail: the theme's ansi color, not the exact chip pastel of
// mods/tasks/look.js; copy its PASTEL table here if the difference shows.
export const tintOf = (t, cwd) => {
  const all = spaces(), repo = cwd?.match(/\/\.herdr\/worktrees\/([^/]+)\//)?.[1];
  const c = (shared("space.colors") ?? {})[(all.find((s) => s.name === repo) ?? all.find((s) => s.active))?.id] ?? "ansi6";
  return c.startsWith("#") ? c : t[c];
};

// A soft glow breathes behind the program icon while the agent works, as on agent rows
// (mods/tasks/look.js has the how), instead of the stock spinner. In the space's color (`tint`),
// else the theme's working color. No icon: a dot. Mods can't import each other: tasks-tabs and
// tasks-pane each keep this copy.
const BREATH = { period: 3000, easing: "ease-in-out" };
const glow = (id, color, from, to, peak) => h_flex().absolute().left(0).top(0).size_full().items_center().justify_center()
  .child(div().id(id).flex_none().rounded_full().bg(color)
    .loop("width", { from, to, ...BREATH }).loop("height", { from, to, ...BREATH }).loop("opacity", { from: peak / 5, to: peak, ...BREATH }));
export const breathing = (id, working, pic, t, tint) => {
  if (!working) return pic;
  const color = tint ?? t.working;
  return h_flex().relative().size(14).flex_none().items_center().justify_center()
    .child(div().absolute().left(-5).top(-5).size(24)
      .child(glow(`${id}-halo-a`, color, 12, 24, 0.09))
      .child(glow(`${id}-halo-b`, color, 9, 18, 0.13))
      .child(glow(`${id}-halo-c`, color, 6, 12, 0.18)))
    .child(pic ?? div().size(7).rounded(4).bg(color));
};
