// Each mod has a copy of this file: Herdr loads a mod only from its own folder.
// Edit mods/tasks/shared.js, then run `herdr-mods-sync share`.
import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, spaces, layout, readTextFile, appHome } from "herdr";

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const boardShown = () => find(layout(), "work-stack")?.active === "board-page";

let lassoConf = {};
export async function loadConf() {
  const text = await readTextFile(`${appHome()}/lasso.json`).catch(() => null);
  try {
    lassoConf = text ? JSON.parse(text) : {};
  } catch {}
  return lassoConf;
}
export const conf = () => lassoConf;

export const bin = (script) => `${appHome()}/bin/${script}`;

export const TICKET = /\b([a-z]{2,6}-\d+)\b/i;

export const DEFAULT_BRANCHES = new Set(["master", "main", "develop"]);
export const isFeatureBranch = (branch) => Boolean(branch) && !DEFAULT_BRANCHES.has(branch);

// ~/.herdr/worktrees/<repo>/<folder>
export const WORKTREE = /\/\.herdr\/worktrees\/([^/]+)\/([^/]+)/;
export const worktreeRepo = (cwd) => cwd?.match(WORKTREE)?.[1] ?? null;

// Two repos can share a branch name, so match the repo too when we know it.
export function prsOnBranch(prs, branch, repo) {
  if (!isFeatureBranch(branch)) return [];
  const onBranch = prs.filter((pr) => pr.branch === branch);
  const inRepo = onBranch.filter((pr) => pr.repo === repo);
  return inRepo.length ? inRepo : onBranch;
}

export function prForBranch(prs, branch, repo) {
  const matches = prsOnBranch(prs, branch, repo);
  return matches.find((pr) => !pr.merged) ?? matches[0] ?? null;
}

// A tab's lead pane: its first agent, else its first focused terminal, else its first terminal.
export function leadPanes(allPanes) {
  const leads = new Map();
  for (const pane of allPanes) {
    if (!pane.terminal) continue;
    const lead = leads.get(pane.tab);
    const better =
      lead && !lead.program?.agent && (pane.program?.agent || (!lead.focused && pane.focused));
    if (!lead || better) leads.set(pane.tab, pane);
  }
  return leads;
}

// Not a shell's folder, a path or the program's own name. `pane` may be a terminal: a parked
// child has no pane.
export function liveTitle(pane) {
  if (!pane || pane.program?.shell) return null;
  const raw = pane.title ?? "";
  const title = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const isPath =
    /^[~/]|^[A-Za-z]:\\/.test(raw.replace(/^[^\p{L}\p{N}~/]+/u, "")) || /^\S*\/\S*$/.test(title);
  const isProgram = title === pane.program?.name || title.toLowerCase() === pane.program?.key;
  return title && !isProgram && !isPath && !title.includes("@") ? title : null;
}

// Herdr names agent tabs after the program ("Claude Code"): that is no name.
export const isNamedTab = (tab, lead) => Boolean(tab?.named) && tab.name !== lead?.program?.name;

// Small words that can't end a title: "Ruleset split and" -> "Ruleset split".
export const LOOSE_END = /(\s+(and|or|but|for|the|of|to|with|in|on|at|by|from|a|an|vs))+$/i;

// A first clause of 2 to n+1 words wins: "Herdr UI, auto-run and sandbox" -> "Herdr UI".
export function words(text, n) {
  const clause = text.split(/[,:;]\s/)[0];
  const clauseFits = /\s/.test(clause) && clause.split(/\s+/).length <= n + 1;
  const pick = clauseFits ? clause : text.split(/\s+/).slice(0, n).join(" ");
  return pick
    .replace(/\s*\([^)]*$/, "")
    .replace(/[\s,:;.-]+$/, "")
    .replace(LOOSE_END, "");
}

// The color says whose turn it is. No fill: nothing for you to do.
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };
const CI_WORD = { FAILURE: "failed", ERROR: "failed", PENDING: "running", EXPECTED: "running" };
export function prLook(t, pr) {
  const state = pr.merged ? "merged" : pr.draft ? "draft" : (REVIEW[pr.review] ?? "open");
  const ci = pr.merged ? null : CI_WORD[pr.ci];
  const color = pr.merged
    ? "ansi5"
    : state === "changes" || ci === "failed"
      ? "ansi3"
      : state === "approved"
        ? "ansi2"
        : null;
  return { label: `${state}${ci ? `, CI ${ci}` : ""}`, fill: color && pastelFill(t, color) };
}

// Radix Colors v3: [light fill, light text, dark fill, dark text].
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
  const chrome = t.chrome ?? "#ffffff";
  return channel(chrome, 1) * 0.3 + channel(chrome, 3) * 0.59 + channel(chrome, 5) * 0.11 < 128;
};

export function pastelFill(t, color) {
  if (color.startsWith("#")) return { bg: color, fg: "#ffffff" };
  const [lightBg, lightFg, darkBg, darkFg] = PASTEL[color] ?? PASTEL.ansi6;
  return isDark(t) ? { bg: darkBg, fg: darkFg } : { bg: lightBg, fg: lightFg };
}
export const spaceFill = (t, id) => pastelFill(t, (shared("space.colors") ?? {})[id] ?? "ansi6");

export function tintOf(t, cwd, space) {
  const all = spaces(),
    repo = worktreeRepo(cwd);
  const id = all.find((s) => s.name === repo)?.id ?? space ?? all.find((s) => s.active)?.id;
  const color = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return color.startsWith("#") ? color : pastelFill(t, color).fg;
}

// A #rrggbbaa color made opaque over `base`.
export function solid(color, base) {
  if (!/^#[0-9a-f]{8}$/i.test(color ?? "") || !/^#[0-9a-f]{6}/i.test(base ?? ""))
    return (color ?? "").slice(0, 7);
  const alpha = channel(color, 7) / 255;
  const mix = (i) => Math.round(channel(color, i) * alpha + channel(base, i) * (1 - alpha));
  return "#" + [1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("");
}

// The end of the text fades when it doesn't fit. The fade is painted, so `bg` must be the
// color the row really shows.
const RECT = () =>
  PathBuilder.fill()
    .move_to("0%", "0%")
    .line_to("100%", "0%")
    .line_to("100%", "100%")
    .line_to("0%", "100%")
    .close()
    .build();
export function fadeText(text, bg, key, view, min) {
  const fit = (view.fit ??= new Map());
  const tooLong = (widths) => (widths?.text ?? 0) > (widths?.box ?? Infinity) + 0.5;
  const measure = (part) => (size, cx) => {
    const widths = fit.get(key) ?? {};
    const was = tooLong(widths);
    widths[part] = size.width;
    fit.set(key, widths);
    if (tooLong(widths) !== was) cx.notify();
  };
  const box = h_flex()
    .id(`fade-${key}`)
    .relative()
    .overflow_hidden()
    .whitespace_nowrap()
    .on_size_change(measure("box"));
  return (min == null ? box.flex_1().min_w(0) : box.flex_initial().min_w(min))
    .child(div().id(`fade-text-${key}`).flex_none().on_size_change(measure("text")).child(text))
    .when(tooLong(fit.get(key)), (el) =>
      el.child(
        div()
          .absolute()
          .top(0)
          .right(0)
          .h_full()
          .w(22)
          .child(
            globalThis.window
              .paint_path(RECT(), Background.linear_gradient(90, bg + "00", bg))
              .absolute()
              .top(0)
              .left(0)
              .size_full(),
          ),
      ),
    );
}

// A fixed box, so nothing moves when work starts or ends.
export const TILE = 18;
// Each agent breathes at its own pace, so working rows drift out of step.
function breathOf(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { period: 2800 + (hash % 7) * 100, easing: "ease-in-out" };
}

// An arc can't ease out once its element is gone, so it stays LINGER ms after work ends.
// Known limit: an agent closed while it works leaves its small entry here.
const LINGER = 400;
const lingering = new Map(); // key → { color, endedAt }
function whileWorking(key, color, working, redrawIn) {
  const now = Date.now(),
    state = lingering.get(key);
  if (working) lingering.set(key, { color });
  else if (state && !state.endedAt) {
    state.endedAt = now;
    redrawIn(LINGER + 30);
  }
  const still = !working && state && now - state.endedAt < LINGER;
  if (!working && state && !still) lingering.delete(key);
  return { show: working || Boolean(still), color: working ? color : state?.color };
}

// 11px around the 7px status dot, so the dot grows from its center and can overshoot.
export const corner = () =>
  h_flex().absolute().right(-4).bottom(-3).size(11).items_center().justify_center();

export const STATUS_SPRING = { response: 400, damping: 0.6 };

export function spinner(color, id, working, redrawIn) {
  const { show, color: ringColor } = redrawIn
    ? whileWorking(`spinner-${id}`, color, working, redrawIn)
    : { show: working, color };
  const size = working ? 10 : 2;
  return h_flex()
    .absolute()
    .left(0)
    .top(0)
    .size_full()
    .items_center()
    .justify_center()
    .child(
      div()
        .id(`spinner-box-${id}`)
        .flex_none()
        .w(size)
        .h(size)
        .spring("width", STATUS_SPRING)
        .spring("height", STATUS_SPRING)
        .opacity(working ? 1 : 0)
        .transition("opacity", working ? 120 : { duration: 180, delay: 140 })
        .when(show, (el) =>
          el.child(
            svg("mods/workspace-chrome/spinner.svg")
              .id(`spinner-${id}`)
              .size_full()
              .text_color(ringColor)
              .spin(1200),
          ),
        ),
    );
}

// No timer: the parts hold their start pose while working and ease to their end pose.
const BURST = 480,
  RIPPLE_TO = 19,
  SPARK_REACH = 8,
  SPARK = 2;
const SPARK_WAYS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
export function burst(id, working, finished, color) {
  const paint = finished ? color : "#00000000";
  const box = 2 * SPARK_REACH + SPARK + 2,
    center = box / 2;
  const fade = (delay) => (working ? 0 : { duration: BURST - delay, delay, easing: "ease-out" });
  const move = working ? 0 : { duration: BURST, easing: "ease-out" };
  const rippleSize = working ? 7 : RIPPLE_TO,
    reach = working ? 0 : SPARK_REACH;
  return div()
    .absolute()
    .left(5.5 - center)
    .top(5.5 - center)
    .size(box)
    .child(
      h_flex()
        .absolute()
        .left(0)
        .top(0)
        .size_full()
        .items_center()
        .justify_center()
        .child(
          div()
            .id(`burst-ripple-${id}`)
            .flex_none()
            .rounded_full()
            .border(1.5)
            .border_color(paint)
            .w(rippleSize)
            .h(rippleSize)
            .transition("width", move)
            .transition("height", move)
            .opacity(working ? 0.8 : 0)
            .transition("opacity", fade(80)),
        ),
    )
    .children(
      SPARK_WAYS.map(([dx, dy], i) =>
        div()
          .id(`burst-spark-${i}-${id}`)
          .absolute()
          .size(SPARK)
          .rounded_full()
          .bg(paint)
          .left(center - SPARK / 2 + dx * reach)
          .top(center - SPARK / 2 + dy * reach)
          .transition("left", move)
          .transition("top", move)
          .opacity(working ? 1 : 0)
          .transition("opacity", fade(160)),
      ),
    );
}

export function breathing(id, working, pic, t, tint) {
  if (!pic && !working) return null;
  const color = tint ?? t.working;
  return h_flex()
    .relative()
    .size(TILE)
    .flex_none()
    .items_center()
    .justify_center()
    .child(pic ?? div().size(7).rounded(4).bg(color))
    .child(corner().child(spinner(color, id, working)));
}

export const workingTitle = (id, text, t, tint) =>
  div()
    .id(`working-title-${id}`)
    .text_color(solid((tint ?? t.working).slice(0, 7) + "40", t.foreground))
    .loop("opacity", { from: 0.8, to: 1, ...breathOf(id) })
    .child(text);
