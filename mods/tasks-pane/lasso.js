// lasso's additions to the shipped `pane` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, spaces } from "herdr";

// An agent pane's short task title (published by mods/tasks as shared "task.short").
// A child agent shows its own label ("task.child"), never its parent tab's title.
export function taskLabel(p) {
  if (!p.program?.agent) return null;
  const kids = shared("task.child") ?? {};
  return p.terminal in kids ? kids[p.terminal] || null : (shared("task.short") ?? {})[p.tab];
}

export const taskChip = (task, t) => div().flex_none().truncate().max_w(260).text_color(t.muted).child(`· ${task}`);

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
