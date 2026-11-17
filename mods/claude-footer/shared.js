// Helpers every lasso mod uses. Herdr loads a mod only from its own folder, so each mod has an
// identical copy of this file. Edit mods/tasks/shared.js, then run `herdr-mods-sync share`.
import { div, svg, PathBuilder, Background } from "gpui-kit";
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
// starts or ends.
export const TILE = 18;
// Each agent breathes at its own pace (2.8 to 3.4 s, from its id), so several working rows
// drift out of step and don't pulse as one block. An agent's own parts stay together.
function breathOf(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { period: 2800 + (hash % 7) * 100, easing: "ease-in-out" };
}

// Whether to still draw what shows while an agent works: { show, color }. A native loop or
// spin can't be eased once its element is gone, so it stays for LINGER ms after work ends.
// ponytail: it goes at the first render after that; until then it turns unseen.
const LINGER = 400;
const lingering = new Map(); // key → { color, endedAt }
function whileWorking(key, color, working) {
  const state = lingering.get(key);
  if (working) lingering.set(key, { color });
  else if (state && !state.endedAt) state.endedAt = Date.now();
  const still = !working && state && Date.now() - state.endedAt < LINGER;
  if (!working && state && !still) lingering.delete(key);
  return { show: working || Boolean(still), color: working ? color : state?.color };
}

// The corner of an agent's icon box: an 11px box around the 7px status dot, so the dot
// grows from its center and has room to overshoot.
export const corner = () => h_flex().absolute().right(-4).bottom(-3).size(11).items_center().justify_center();

// While the agent works, a small arc in its space's color turns in that corner. Its box is
// always there and springs between 10px and almost nothing: when work ends the ring closes
// into the status dot that grows in its place, and when work starts it opens out of it.
// One elastic spring for the ring and the dot, so they move as one thing.
export const STATUS_SPRING = { response: 400, damping: 0.6 };
export function spinner(color, id, working) {
  const { show, color: ringColor } = whileWorking(`spinner-${id}`, color, working);
  const size = working ? 10 : 2;
  return h_flex().absolute().left(0).top(0).size_full().items_center().justify_center()
    .child(div().id(`spinner-box-${id}`).flex_none().w(size).h(size).spring("width", STATUS_SPRING).spring("height", STATUS_SPRING)
      .opacity(working ? 1 : 0).transition("opacity", working ? 120 : { duration: 180, delay: 140 })
      .when(show, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").id(`spinner-${id}`).size_full().text_color(ringColor).spin(1200))));
}

// A program icon in its TILE box with the spinner, for the tab bar and pane headers.
// `tint`: tintOf(). No icon: nothing, unless the agent works.
export function breathing(id, working, pic, t, tint) {
  if (!pic && !working && !lingering.has(`spinner-${id}`)) return null;
  return h_flex().relative().size(TILE).flex_none().items_center().justify_center()
    .children(pic ? [pic] : [])
    .child(corner().child(spinner(tint ?? t.working, id, working)));
}

// A working agent's title: a light tint of its space's color, breathing gently.
// It never dims below 80%, so it reads as working at any moment.
export const workingTitle = (id, text, t, tint) => div().id(`working-title-${id}`)
  .text_color(solid((tint ?? t.working).slice(0, 7) + "40", t.foreground))
  .loop("opacity", { from: 0.8, to: 1, ...breathOf(id) })
  .child(text);
