// The tour's sparkle: what floats next to the thing to look at.
import { div, svg } from "gpui-kit";

const STAR = "mods/tour/spark.svg";
export const SPARK = 28;
// The Work tile's pink wash and violet (mods/tasks/lasso.js): lasso's own colors.
const PINK = "#f472b6",
  PURPLE = "#8b5cf6";
// Lively but not busy: the glow breathes, the star sways a touch, the color drifts more
// slowly and three glints flash in turn. Periods that share no beat, so nothing repeats.
const BREATH = 1800,
  SWAY = 1300,
  SHIFT = 3100,
  BLOOM = 260;

const centered = () => div().absolute().inset_0().flex().items_center().justify_center();

// A small star that is dark most of the time: two loops multiply, so it peaks only when
// both do.
const glint = (color, left, top, size, slow) =>
  div()
    .absolute()
    .left(left)
    .top(top)
    .size(size)
    .loop("opacity", { from: 0, to: 1, period: slow })
    .child(svg(STAR).size(size).text_color(color).loop("opacity", { from: 0, to: 1, period: 600 }));

// Only opacity can loop, so the color shifts by fading a purple copy in and out over the pink.
const shifting = (shape, period = SHIFT) => [
  shape(PINK),
  shape(PURPLE).loop("opacity", { from: 0, to: 0.75, period }),
];

// A star that all but keeps its place, so it is clear what it points at. `resting`: it has
// landed, and its glow and glints bloom. In flight it is the bare star. `seed`: which one of
// several it is. Each gets its own pace and its own small wander, so a group moves like
// little creatures and never in step.
export const spark = (t, { resting = true, seed = 0 } = {}) => {
  const pace = (period) => Math.round(period * (1 + 0.17 * ((seed * 3) % 5))),
    // How far it wanders, in px: under two, so it never leaves its line.
    reach = 0.65 * (1 + (seed % 3));
  const disc = (color) =>
    centered().child(
      div()
        .rounded_full()
        .bg(color + "40")
        .loop("width", { from: 12, to: 26, period: pace(BREATH) })
        .loop("height", { from: 12, to: 26, period: pace(BREATH) }),
    );
  const star = (color) => centered().child(svg(STAR).size(18).text_color(color));
  return (
    div()
      .relative()
      .w(SPARK)
      .h(SPARK)
      .flex_none()
      .child(
        div()
          .id("spark-bloom")
          .absolute()
          .inset_0()
          .opacity(resting ? 1 : 0)
          .transition("opacity", { duration: BLOOM, easing: "ease-out" })
          // A faint wide disc under the breathing one: a soft edge, since nothing can blur.
          .child(
            centered().child(
              div()
                .size(SPARK)
                .rounded_full()
                .bg(PINK + "14"),
            ),
          )
          .child(
            div()
              .absolute()
              .inset_0()
              .loop("opacity", { from: 0.35, to: 1, period: pace(BREATH) })
              .children(shifting(disc, pace(SHIFT))),
          )
          .child(glint(PURPLE, 20, 0, 8, pace(1900)))
          .child(glint(t.foreground, 1, 20, 6, pace(1300)))
          .child(glint(t.foreground, 0, 2, 6, pace(2300))),
      )
      // A px or two each way, so it stays clear which line it points at. Up and down at one
      // pace, side to side at another: together a slow wander.
      .child(
        div()
          .absolute()
          .size(SPARK)
          .loop("top", { from: -0.65, to: 0.65, period: pace(SWAY) })
          .loop("left", { from: -reach, to: reach, period: pace(SWAY * 1.7) })
          .children(shifting(star, pace(SHIFT))),
      )
  );
};
