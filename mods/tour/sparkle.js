// The tour's sparkle: what floats next to the thing to look at.
import { div, svg } from "gpui-kit";

const STAR = "mods/tour/spark.svg";
export const SPARK = 28;
// The Work tile's pink wash and violet (mods/tasks/lasso.js): lasso's own colors.
const PINK = "#f472b6",
  PURPLE = "#8b5cf6";
// One slow breath from pink toward violet and back. Pink leads: the violet never covers it.
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
  shape(PURPLE).loop("opacity", { from: 0, to: 0.75, period: SHIFT }),
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
      .bg(color + "33");
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
