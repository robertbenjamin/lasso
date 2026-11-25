// The sparkle's window (props.spark): see-through, over the app, as big as its flight.
// card.js draws it.
import { div } from "gpui-kit";
import { props, openOverlay, closeOverlay, shared } from "herdr";
import { SPARK } from "./sparkle.js";
import { real, same } from "./places.js";
import { flight, FADE } from "./card.js";

// The spring has settled by then. Several land one after another: they bloom after LAND.
const FLIGHT = 1000,
  LAND = 650;
// Room around a flight for the spring's overshoot.
const OVERSHOOT = 24;
// Further sideways than this is another section: the sparkle does not fly, it fades in here.
const JUMP = 400;

export const far = (a, b) => Math.abs(a.x - b.x) > JUMP;

// Opens a window for the sparkle: as big as what it must hold and no bigger, because a
// window takes the clicks on what is under it. `stars`: where each sparkle ends up. They all
// start at `from` and spring out, so one flies there, and several split from one.
// `fade`: they fade in. `nudges`: see state.js. `group`: the target, when it has several places.
export function fly(from, stars, fade, nudges, group) {
  const all = [from, ...stars],
    edge = (axis, pick) => pick(...all.map((star) => star[axis])),
    // The dip at the end of a long drop is a few px of every hundred.
    drop = edge("y", Math.max) - edge("y", Math.min),
    pad = all.every((star) => same(star, from)) ? 0 : Math.max(OVERSHOOT, Math.round(0.06 * drop)),
    origin = {
      x: Math.max(0, edge("x", Math.min) - pad),
      y: Math.max(0, edge("y", Math.min) - pad),
    };
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    at: real(origin),
    props: {
      spark: {
        from,
        stars,
        fade,
        nudges,
        group,
        origin,
        width: edge("x", Math.max) + SPARK + pad - origin.x,
        height: edge("y", Math.max) + SPARK + pad - origin.y,
      },
    },
  });
}

// The sparkles start where the one before was and spring to their places, bare. Once
// there they bloom. A lone one that has flown gets a window just its own size, so the
// flight's does not stay over the work: the bare star hides that swap.
export function init(view, cx) {
  const { from, stars, fade, nudges, group } = props().spark,
    still = !group && same(from, stars[0]),
    later = (ms, change) =>
      cx.timer.after(ms, (cx) => {
        change();
        cx.notify();
      });
  view.out = false;
  view.glows = !fade;
  // A sparkle that was resting here keeps its glow a moment: it fades as it takes off,
  // and stays on when it only splits.
  view.rests = !fade;
  later(50, () => {
    view.out = true;
    view.glows = true;
    view.rests = still || (Boolean(group) && !fade);
  });
  if (group) later(LAND, () => (view.rests = true));
  if (group || still) return;
  cx.timer.after(FLIGHT, () => fly(stars[0], stars, false, nudges));
  cx.timer.after(FLIGHT + 150, () => closeOverlay(props().overlay));
}

// Only render may ask whether the sparkle is still the tour's: a timer reads shared state
// from before the change.
export function render(view, t, cx) {
  const { from, stars, origin, width, height, group = null, nudges } = props().spark,
    at = shared("tour.step") ? shared("tour.at") : null,
    mine = same(at, stars[0]) && at.nudges === nudges && (at.group ?? null) === group;
  if (!mine) {
    // A flight from here takes this one's place at once. A sparkle that jumped far away,
    // or a tour that ended, lets it fade out.
    if (at && !far(at, stars[0])) return closeOverlay(props().overlay) ?? div();
    if (!view.leaving) {
      view.leaving = true;
      cx.timer.after(2 * FADE + 60 * stars.length, () => closeOverlay(props().overlay));
    }
  }
  return flight(t, {
    width,
    height,
    shown: view.glows && mine,
    resting: view.rests,
    out: view.out,
    stars: stars.map((star) => {
      const { x, y } = view.out ? star : from;
      return { x: x - origin.x, y: y - origin.y, travels: !same(star, from) };
    }),
  });
}
