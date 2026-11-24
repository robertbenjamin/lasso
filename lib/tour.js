import { div, svg } from "gpui-kit";
import { shared } from "herdr";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// mods/tour names in shared "tour.focus" the sections a step is about. Every other section
// adds `.children(tourVeil(t, "its-name"))` to its root and fades under a veil that breathes.
// Mods cannot blur, and a terminal cannot be veiled: only mods draw this.
const VEIL = "d9"; // 85%, as hex alpha
export function tourVeiled(section) {
  const focus = shared("tour.step") ? shared("tour.focus") : null;
  return Boolean(focus?.length) && !focus.includes(section);
}

export function tourVeil(t, section) {
  if (!tourVeiled(section)) return [];
  return [
    div()
      .absolute()
      .inset_0()
      .bg(t.chrome + VEIL)
      .loop("opacity", { from: 0.82, to: 1, period: 3200 }),
  ];
}

const STAR = "mods/tour/spark.svg";
export const SPARK = 28;
// The Work tile's gradient (mods/tasks/lasso.js), so the sparkle is in lasso's own colors.
const PINK = "#ec4899",
  PURPLE = "#8b5cf6";
// One slow breath from pink to purple and back.
const SHIFT = 2600;

const glint = (color, left, top, size, period) =>
  svg(STAR)
    .absolute()
    .left(left)
    .top(top)
    .size(size)
    .text_color(color)
    .loop("opacity", { from: 0, to: 1, period });

// Only opacity can loop, so the color shifts by fading a purple copy in and out over the pink.
const shifting = (shape) => [
  shape(),
  shape(PURPLE).loop("opacity", { from: 0, to: 1, period: SHIFT }),
];

// The sparkle: a star that bobs in a soft glow and shifts between pink and purple, with
// glints that twinkle out of step.
export const spark = (t) => {
  const glow = (color = PINK) =>
    div()
      .absolute()
      .left(4)
      .top(4)
      .size(20)
      .rounded(10)
      .bg(color + "40");
  const star = (color = PINK) => svg(STAR).absolute().left(0).top(0).size(18).text_color(color);
  return div()
    .w(SPARK)
    .h(SPARK)
    .flex_none()
    .child(
      div()
        .absolute()
        .inset_0()
        .loop("opacity", { from: 0.25, to: 1, period: 1500 })
        .children(shifting(glow)),
    )
    .child(
      div()
        .absolute()
        .left(5)
        .size(18)
        .loop("top", { from: 3, to: 7, period: 1000 })
        .children(shifting(star)),
    )
    .child(glint(t.foreground, 0, 3, 7, 700))
    .child(glint(PURPLE, 20, 0, 8, 1100))
    .child(glint(t.foreground, 21, 19, 6, 900))
    .child(glint(PINK, 1, 21, 5, 1300));
};
