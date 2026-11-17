// Helpers every lasso mod uses. Herdr loads a mod only from its own folder, so each mod has an
// identical copy of this file. Edit mods/tasks/shared.js, then run `herdr-mods-sync share`.
import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared, spaces } from "herdr";

// A layout node by id.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Every copy of a mod runs the same timers. True for one caller per `ms`: it stamps the shared
// `key`, so the others skip the work.
export function myTurn(key, ms) {
  if (Date.now() - (shared(key) ?? 0) < ms) return false;
  setShared(key, Date.now());
  return true;
}

// PR colors and words. Calm: a failed check is amber, a running one gray, no red.
export const CI = { SUCCESS: "ansi2", FAILURE: "working", ERROR: "working", PENDING: "dim", EXPECTED: "dim" };
export const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };

// Space colors from Radix Colors v3, per theme color name: [light fill, light text, dark fill, dark text].
const PASTEL = {
  ansi6: ["#ccf3ea", "#008573", "#084843", "#0bd8b6"], // teal
  ansi3: ["#ffdfb5", "#cc4e00", "#562800", "#ffa057"], // orange
  ansi4: ["#d5efff", "#0d74ce", "#004074", "#70b8ff"], // blue
  ansi5: ["#ebe4ff", "#6550b9", "#3c2e69", "#baa7ff"], // violet
  ansi2: ["#daf1db", "#2a7e3b", "#25482d", "#71d083"], // grass
  ansi1: ["#fbdcef", "#c2298a", "#591c47", "#ff8dcc"], // pink
};
const channel = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
const isDark = (t) => {
  const c = t.chrome ?? "#ffffff";
  return channel(c, 1) * 0.3 + channel(c, 3) * 0.59 + channel(c, 5) * 0.11 < 128;
};

// { bg, fg } for a space color: a theme color name, or a picked #rrggbb (kept as is).
export function pastelFill(t, color) {
  if (color.startsWith("#")) return { bg: color, fg: "#ffffff" };
  const p = PASTEL[color] ?? PASTEL.ansi6;
  return isDark(t) ? { bg: p[2], fg: p[3] } : { bg: p[0], fg: p[1] };
}
export const spaceFill = (t, id) => pastelFill(t, (shared("space.colors") ?? {})[id] ?? "ansi6");

// The glow color of an agent in folder `cwd`: the color of its repo's space (for a worktree),
// else of `space`, else of the active space.
export function tintOf(t, cwd, space) {
  const all = spaces(), repo = cwd?.match(/\/\.herdr\/worktrees\/([^/]+)\//)?.[1];
  const id = all.find((s) => s.name === repo)?.id ?? space ?? all.find((s) => s.active)?.id;
  const color = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return color.startsWith("#") ? color : pastelFill(t, color).fg;
}

// A #rrggbbaa color made opaque over `base`.
export function solid(color, base) {
  if (!/^#[0-9a-f]{8}$/i.test(color ?? "") || !/^#[0-9a-f]{6}/i.test(base ?? "")) return (color ?? "").slice(0, 7);
  const alpha = channel(color, 7) / 255;
  const mix = (i) => Math.round(channel(color, i) * alpha + channel(base, i) * (1 - alpha));
  return "#" + [1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("");
}

// Text that fades out at its end when it doesn't fit (no ellipsis). `bg` is the row's real
// color, `view.fit` keeps the measured widths per `key`. With `min`, the box sizes from its
// text and shrinks down to `min`; without, it fills the row.
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
export function fadeText(text, bg, key, view, min) {
  const fit = (view.fit ??= new Map());
  const tooLong = (f) => (f?.text ?? 0) > (f?.box ?? Infinity) + 0.5;
  const measure = (part) => (size, cx) => {
    const f = fit.get(key) ?? {};
    const was = tooLong(f);
    f[part] = size.width;
    fit.set(key, f);
    if (tooLong(f) !== was) cx.notify();
  };
  const box = h_flex().id(`fade-${key}`).relative().overflow_hidden().whitespace_nowrap().on_size_change(measure("box"));
  return (min == null ? box.flex_1().min_w(0) : box.flex_initial().min_w(min))
    .child(div().id(`fade-text-${key}`).flex_none().on_size_change(measure("text")).child(text))
    .when(tooLong(fit.get(key)), (el) => el.child(div().absolute().top(0).right(0).h_full().w(22)
      .child(globalThis.window.paint_path(RECT(), Background.linear_gradient(90, bg + "00", bg)).absolute().top(0).left(0).size_full())));
}

// A soft glow that breathes behind an icon of `box` px while its agent works: three discs on
// top of each other fake a blurred edge, and a thin ring gives it a crisp one. A native loop
// stays on its element, so draw it only while working.
const BREATH = { period: 3000, easing: "ease-in-out" };
const centered = () => h_flex().absolute().left(0).top(0).size_full().items_center().justify_center();
const glow = (id, color, from, to, peak) => centered().child(div().id(id).flex_none().rounded_full().bg(color)
  .loop("width", { from, to, ...BREATH }).loop("height", { from, to, ...BREATH }).loop("opacity", { from: peak / 5, to: peak, ...BREATH }));
const ring = (id, color, size) => centered().child(div().id(id).flex_none().size(size).rounded_full().border(1.5).border_color(color)
  .loop("opacity", { from: 0.15, to: 0.7, ...BREATH }));
export const halo = (color, id, box) => div().absolute().left(-5).top(-5).size(box + 10)
  .child(glow(`halo-a-${id}`, color, box - 2, box + 10, 0.14))
  .child(glow(`halo-b-${id}`, color, box - 5, box + 4, 0.22))
  .child(glow(`halo-c-${id}`, color, box - 8, box - 2, 0.32))
  .child(ring(`halo-ring-${id}`, color, box + 6));

// A 14px program icon (or a dot) with the glow while its agent works. `tint`: tintOf().
export function breathing(id, working, pic, t, tint) {
  if (!working) return pic;
  const color = tint ?? t.working;
  return h_flex().relative().size(14).flex_none().items_center().justify_center()
    .child(halo(color, id, 14))
    .child(pic ?? div().size(7).rounded(4).bg(color));
}
