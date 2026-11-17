// Shared looks for the agents list (main.js) and the Work board (board.js): space colors,
// the space card and pill, and text that fades out instead of ending in an ellipsis.
import { div, image, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";
import { isAlias } from "./work.js";

// Space tiles from Radix Colors (radix-ui.com/colors, v3): per theme color name, light step 4
// (fill) and 11 (letter), then dark step 5 and 11. A picked #rrggbb stays as is.
// mods/tasks-spaces/lasso.js has the same table: Herdr loads a mod only from its own folder.
const PASTEL = {
  ansi6: ["#ccf3ea", "#008573", "#084843", "#0bd8b6"], // teal
  ansi3: ["#ffdfb5", "#cc4e00", "#562800", "#ffa057"], // orange
  ansi4: ["#d5efff", "#0d74ce", "#004074", "#70b8ff"], // blue
  ansi5: ["#ebe4ff", "#6550b9", "#3c2e69", "#baa7ff"], // violet
  ansi2: ["#daf1db", "#2a7e3b", "#25482d", "#71d083"], // grass
  ansi1: ["#fbdcef", "#c2298a", "#591c47", "#ff8dcc"], // pink
};
const dark = (t) => { const h = (t.chrome ?? "#ffffff").slice(1, 7); return parseInt(h.slice(0, 2), 16) * 0.3 + parseInt(h.slice(2, 4), 16) * 0.59 + parseInt(h.slice(4, 6), 16) * 0.11 < 128; };

// mods/tasks-spaces/lasso.js has the same pastelFill: Herdr loads a mod only from its own folder.
export function pastelFill(t, color) {
  if (color.startsWith("#")) return { bg: color, fg: "#ffffff" };
  const p = PASTEL[color] ?? PASTEL.ansi6;
  return dark(t) ? { bg: p[2], fg: p[3] } : { bg: p[0], fg: p[1] };
}
export const spaceFill = (t, id) => pastelFill(t, (shared("space.colors") ?? {})[id] ?? "ansi6");

// A small card with the space's code, in the space's color: names the space on a sidebar row
// that has no space header above it. `label` is the row's space label (a worktree's repo, its
// alias applied): an alias (repoAliases in lasso.json) shows as written, else its first 3 letters.
export function spaceCard(t, id, name, label) {
  const { bg, fg } = spaceFill(t, id);
  return h_flex().id(`space-card-${id}`).h(16).px(4).flex_none().rounded(4).bg(bg).items_center()
    .text_size(9.5).font_semibold().text_color(fg).tooltip(name)
    .child(isAlias(label) ? label : [...label.replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 3).join("").toUpperCase() || "?");
}

// A repo's space: the space named after it (its main checkout), whose color the repo's cards
// share, so a worktree's agents wear their repo's color. None: the agent's own space.
export const repoSpace = (spaces, repo, fallback) => spaces.find((s) => s.name === repo)?.id ?? fallback;

// The board's roomier version: the whole space label in a pill of the space's color.
export const spacePill = (t, id, label) => {
  const { bg, fg } = spaceFill(t, id);
  return h_flex().h(18).px(6).flex_none().rounded(5).bg(bg).items_center().text_size(11).font_medium().text_color(fg).child(label);
};

// A theme color made opaque over `base`: a fade must end in the color the row really shows.
export function solid(c, base) {
  if (!/^#[0-9a-f]{8}$/i.test(c ?? "") || !/^#[0-9a-f]{6}/i.test(base ?? "")) return (c ?? "").slice(0, 7);
  const n = (h, i) => parseInt(h.slice(i, i + 2), 16), a = n(c, 7) / 255;
  return "#" + [1, 3, 5].map((i) => Math.round(n(c, i) * a + n(base, i) * (1 - a)).toString(16).padStart(2, "0")).join("");
}

// A line of text that fades out at its end instead of an ellipsis, only when it doesn't fit:
// the box and the text report their widths, and `view.fit` keeps them per `key`. `bg` is the
// row's color, so the fade ends in what the row really shows.
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const fade = (bg) => div().absolute().top(0).right(0).h_full().w(22)
  .child(globalThis.window.paint_path(RECT(), Background.linear_gradient(90, bg + "00", bg)).absolute().top(0).left(0).size_full());
export function fadeText(text, bg, key, view) {
  const fit = (view.fit ??= new Map());
  const over = (f) => (f?.text ?? 0) > (f?.box ?? Infinity) + 0.5;
  const measure = (k) => (size, cx) => {
    const f = fit.get(key) ?? {};
    const was = over(f);
    f[k] = size.width;
    fit.set(key, f);
    if (over(f) !== was) cx.notify();
  };
  return h_flex().id(`fade-${key}`).relative().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().on_size_change(measure("box"))
    .child(div().id(`fade-text-${key}`).flex_none().on_size_change(measure("text")).child(text))
    .when(over(fit.get(key)), (el) => el.child(fade(bg)));
}

// A soft disc in the working color that swells and brightens behind a working agent's icon, so
// the icon itself stays crisp. `box` is the square it is centered on; it reaches 4px past it.
// A native loop stays on its element: draw it only while working.
const HALO = { period: 2400, easing: "ease-in-out" };
export const halo = (t, id, box) => h_flex().absolute().left(-4).top(-4).size(box + 8).items_center().justify_center()
  .child(div().id(`halo-${id}`).flex_none().rounded_full().bg(t.working)
    .loop("width", { from: box - 6, to: box + 8, ...HALO }).loop("height", { from: box - 6, to: box + 8, ...HALO })
    .loop("opacity", { from: 0.06, to: 0.34, ...HALO }));

// An agent's icon carrying its status: a halo breathes behind it while working, a dot on its
// corner says blocked (red) or done (the done color); idle, it fades unless it's the one you're
// on. The dot is always there and eases in and out, keeping its last color while it fades away.
// Every agent row uses it, parent or child, sidebar or board. No icon: a plain dot carries it.
const dotColor = new Map();
export function statusIcon(t, id, status, focused, pic) {
  pic ??= div().size(8).rounded(4).bg(t.muted);
  const color = status === "blocked" ? t.blocked : status === "done" ? (t.done ?? t.ansi2) : null;
  if (color) dotColor.set(id, color);
  const tip = { working: "Working", blocked: "Needs you", done: "Done" }[status] ?? "Idle";
  return h_flex().id(`st-${id}`).relative().size(18).flex_none().items_center().justify_center().tooltip(tip)
    .when(status === "working", (el) => el.child(halo(t, id, 18)))
    .child(div().id(`st-pic-${id}`).opacity(status === "idle" && !focused ? 0.45 : 1).transition("opacity", 220).child(pic))
    .child(div().id(`st-dot-${id}`).absolute().right(-2).bottom(-1).size(7).rounded(4).bg(dotColor.get(id) ?? t.blocked)
      .opacity(color ? 1 : 0).transition("opacity", 260));
}

// Forgets measured widths and dot colors of rows no longer drawn: keys are `${prefix}${id}`
// in view.fit, `${id}` (agents) or `w-${tab}` (board) in the dot colors.
export function forget(view, alive, prefix) {
  for (const k of view.fit?.keys() ?? []) if (k.startsWith(prefix) && !alive.has(k.slice(prefix.length))) view.fit.delete(k);
  for (const k of dotColor.keys()) if ((prefix === "w-") === k.startsWith("w-") && !alive.has(prefix === "w-" ? k.slice(2) : k)) dotColor.delete(k);
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
export function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// A status mark where there's no agent icon to carry it (a folded group's header): a dot that
// breathes while working, as the icon does (statusIcon). `id` keeps the loop on its own element.
export function statusMark(t, status, id) {
  const dot = (c) => div().id(`mark-${id}-${status}`).size(7).mx(3).flex_none().rounded(4).bg(c);
  if (status === "working") return dot(t.working).loop("opacity", { from: 0.35, to: 1, period: 2100, easing: "ease-in-out" });
  if (status === "blocked") return dot(t.blocked);
  if (status === "done") return dot(t.done ?? t.ansi2);
  return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
}
