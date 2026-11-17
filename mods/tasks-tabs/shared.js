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

// An agent's icon is a 14px glyph in a TILE px box, everywhere, so nothing moves when work
// starts or ends. While the agent works, a soft light in its space's color glows around the
// icon: six faint discs on top of each other fake a blur, wide enough to show past the
// icon and with no bright core. It breathes but keeps FLOOR of its brightness, so it shows at
// any moment.
export const TILE = 18;
const BREATH = { period: 3000, easing: "ease-in-out" };
const FLOOR = 0.8, REACH = 6; // the glow reaches REACH px past the box
// [size at rest, size at the peak, opacity at the peak], widest first
const DISCS = [[25, 30, 0.1], [22, 27, 0.13], [19, 24, 0.16], [16, 21, 0.18], [13, 17, 0.2], [10, 13, 0.2]];
const halo = (color, id) => div().absolute().left(-REACH).top(-REACH).size(TILE + 2 * REACH)
  .children(DISCS.map(([from, to, peak], i) => h_flex().absolute().left(0).top(0).size_full().items_center().justify_center()
    .child(div().id(`halo-${i}-${id}`).flex_none().rounded_full().bg(color)
      .loop("width", { from, to, ...BREATH }).loop("height", { from, to, ...BREATH })
      .loop("opacity", { from: peak * FLOOR, to: peak, ...BREATH }))));

// A layer that fades in when work starts and out when it ends. The wrapper is always there
// and eases its opacity. A native loop can't be faded once its element is gone, so what
// `build(color)` draws stays for FADE_OUT ms after work ends.
// ponytail: it goes at the first render after that; until then it loops unseen.
const FADE_IN = 320, FADE_OUT = 200;
const fadingOut = new Map(); // key → { color, endedAt }
function whileWorking(key, color, working, build) {
  const state = fadingOut.get(key);
  if (working) fadingOut.set(key, { color });
  else if (state && !state.endedAt) state.endedAt = Date.now();
  const lingering = !working && state && Date.now() - state.endedAt < FADE_OUT + 80;
  if (!working && state && !lingering) fadingOut.delete(key);
  return div().id(key).absolute().left(0).top(0).size_full()
    .opacity(working ? 1 : 0).transition("opacity", { duration: working ? FADE_IN : FADE_OUT, easing: "ease-out" })
    .when(working || lingering, (el) => el.child(build(working ? color : state.color)));
}

// The glow. Put it in a `relative` box of TILE px, before the icon.
export const fadingHalo = (color, id, working) => whileWorking(`halo-fade-${id}`, color, working, (c) => halo(c, id));

// A soft light in the space's color across a working row, breathing with the icon's glow.
// Eight full-width layers in the row's own rounded shape, each 1.5px smaller than the last,
// sit on top of each other: the
// light is even along the row and fades out over its last 10px on every side, so it never
// ends in a hard line against the rows above and below.
// Put it first in a `relative` row. ROW_GLOW is its strength in the middle, for the title's fade.
const ROW_LAYERS = 8, ROW_STEP = 1.5, ROW_LAYER_ALPHA = 0.022;
export const ROW_GLOW = 0.15;
export const rowGlow = (color, id, working) => whileWorking(`row-glow-fade-${id}`, color, working, (c) =>
  div().id(`row-glow-${id}`).absolute().left(0).top(0).size_full().loop("opacity", { from: FLOOR, to: 1, ...BREATH })
    .children(Array.from({ length: ROW_LAYERS }, (_, i) => i * ROW_STEP).map((inset) =>
      div().absolute().left(inset).right(inset).top(inset).bottom(inset).rounded(Math.max(8 - inset / 2, 3)).bg(c).opacity(ROW_LAYER_ALPHA))));

// A program icon (or a dot) in its TILE box, for the tab bar and pane headers. `tint`: tintOf().
export function breathing(id, working, pic, t, tint) {
  const color = tint ?? t.working;
  if (!pic && !working && !fadingOut.has(`halo-fade-${id}`)) return null;
  return h_flex().relative().size(TILE).flex_none().items_center().justify_center()
    .child(fadingHalo(color, id, working))
    .child(pic ?? div().size(7).rounded(4).bg(color).opacity(working ? 1 : 0).transition("opacity", FADE_OUT));
}

// A working agent's title: a light tint of its glow color, breathing gently with the glow.
// It never dims below 80%, so it reads as working at any moment.
export const workingTitle = (id, text, t, tint) => div().id(`working-title-${id}`)
  .text_color(solid((tint ?? t.working).slice(0, 7) + "40", t.foreground))
  .loop("opacity", { from: 0.8, to: 1, ...BREATH })
  .child(text);
