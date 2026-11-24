import { div, svg } from "gpui-kit";
import { shared } from "herdr";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// mods/tour names in shared "tour.spark" the one thing to look at: an agent's address,
// "new-work", or "context:<beat>". The mod that draws that thing puts the sparkle beside it.
// Only while a tour runs: a spark left behind by a tour that did not end must not show.
const sparkAt = () => (shared("tour.step") ? (shared("tour.spark") ?? null) : null);

const STAR = "mods/tour/spark.svg";
const BOX = 16;

// A star that bobs, with a small one that twinkles beside it.
export const spark = (t) =>
  div()
    .w(BOX)
    .h(BOX)
    .flex_none()
    .child(
      svg(STAR)
        .absolute()
        .left(0)
        .size(12)
        .text_color(t.accent)
        .loop("top", { from: 0, to: 4, period: 900 }),
    )
    .child(
      svg(STAR)
        .absolute()
        .left(10)
        .top(0)
        .size(6)
        .text_color(t.accent)
        .loop("opacity", { from: 0, to: 1, period: 700 }),
    );

export const tourSpark = (t, target) => (sparkAt() === target ? [spark(t)] : []);

// The beat of "<name>:<beat>", for a spark that hops along a list: null when it is elsewhere.
export function tourBeat(name) {
  const [target, beat] = (sparkAt() ?? "").split(":");
  return target === name && beat !== undefined ? Number(beat) : null;
}
