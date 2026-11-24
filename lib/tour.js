import { div, svg } from "gpui-kit";
import { shared } from "herdr";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// mods/tour names in shared "tour.focus" the sections a step is about. Every other section
// adds `.children(tourVeil(t, "its-name"))` to its root and fades under a veil that breathes.
// Mods cannot blur, and a terminal cannot be veiled: only mods draw this.
const VEIL = "d9"; // 85%, as hex alpha
export function tourVeil(t, section) {
  const focus = shared("tour.step") ? shared("tour.focus") : null;
  if (!focus?.length || focus.includes(section)) return [];
  return [
    div()
      .absolute()
      .inset_0()
      .bg(t.chrome + VEIL)
      .loop("opacity", { from: 0.82, to: 1, period: 3200 }),
  ];
}

const STAR = "mods/tour/spark.svg";
export const SPARK = 24;

const glint = (color, left, top, size, period) =>
  svg(STAR)
    .absolute()
    .left(left)
    .top(top)
    .size(size)
    .text_color(color)
    .loop("opacity", { from: 0, to: 1, period });

// The sparkle: a star that bobs in a soft glow, with glints that twinkle out of step.
export const spark = (t) =>
  div()
    .w(SPARK)
    .h(SPARK)
    .flex_none()
    .child(
      div()
        .absolute()
        .left(3)
        .top(3)
        .size(18)
        .rounded(9)
        .bg(t.accent + "55")
        .loop("opacity", { from: 0.15, to: 1, period: 1500 }),
    )
    .child(
      svg(STAR)
        .absolute()
        .left(5)
        .size(14)
        .text_color(t.accent)
        .loop("top", { from: 3, to: 7, period: 1000 }),
    )
    .child(glint(t.foreground, 0, 3, 6, 700))
    .child(glint(t.accent, 17, 0, 7, 1100))
    .child(glint(t.foreground, 18, 16, 5, 900))
    .child(glint(t.accent, 1, 18, 4, 1300));
