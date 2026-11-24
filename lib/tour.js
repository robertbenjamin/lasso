import { div, svg } from "gpui-kit";
import { shared, setShared } from "herdr";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// While a tour runs, every section of lasso adds `.children(tourVeil(t, "its-name"))` to its
// root. That puts a layer over it that takes the clicks, so a click outside the tour cannot
// leave it in a state the tour does not expect: the tour's card says so instead (tourNudge).
// mods/tour names in shared "tour.focus" the sections a step is about. The others also fade
// under the layer, which breathes. Mods cannot blur, and only mods can draw this: mods/tour
// lays a window over the terminals.
export const VEIL = "d9"; // 85%, as hex alpha
export const breathes = (el) => el.loop("opacity", { from: 0.82, to: 1, period: 3200 });

export function tourVeiled(section) {
  const focus = shared("tour.step") ? shared("tour.focus") : null;
  return Boolean(focus?.length) && !focus.includes(section);
}

// The card opens again on top and says that the tour is on.
export const tourNudge = () => setShared("tour.top", (shared("tour.top") ?? 0) + 1);

export function tourVeil(t, section) {
  if (!shared("tour.step")) return [];
  return [
    div()
      .id(`tour-veil-${section}`)
      .absolute()
      .inset_0()
      .when(tourVeiled(section), (el) => breathes(el.bg(t.chrome + VEIL)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(tourNudge),
  ];
}

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
