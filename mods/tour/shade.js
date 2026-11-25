// The shade's window (props.shade): it fades the terminals, or the whole app, for one step.
// Mods fade themselves (lib/tour.js); only a window can fade terminals. card.js draws it.
import { props, openOverlay, closeOverlay, shared } from "herdr";
import { tourNudge, VEIL_FADE } from "./lib/shared.js";
import { real, main } from "./places.js";
import { shade } from "./card.js";

// For a step whose focus leaves out the terminals ("main"). No sections: the whole app.
export function dim(step) {
  if (!step.focus || step.focus.includes("main")) return;
  const whole = !step.focus.length;
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    at: real(main(whole)),
    // Sized as a share of the window: content as big as the window does not show.
    ...(whole ? { width: 1, height: 1 } : {}),
    props: { shade: step.id, whole },
  });
}

export function init(view, cx) {
  cx.timer.after(30, (cx) => {
    view.shows = true;
    cx.notify();
  });
}

// It fades in, and out once the tour has moved to another step.
export function render(view, t, cx) {
  const gone = shared("tour.step") !== props().shade,
    { whole } = props();
  if (gone && !view.leaving) {
    view.leaving = true;
    cx.timer.after(VEIL_FADE + 40, () => closeOverlay(props().overlay));
  }
  return shade(t, { ...main(whole), whole, shown: view.shows && !gone, onPress: tourNudge });
}
