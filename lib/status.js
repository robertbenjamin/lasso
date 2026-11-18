import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { solid } from "./colors.js";

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
