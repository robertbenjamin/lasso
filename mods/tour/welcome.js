// The welcome dialog (`mod.open tour`): it lists the steps, makes the demo and starts the tour.
// card.js draws it.
import { props, closeOverlay, setShared } from "herdr";
import { STEPS } from "./steps.js";
import { up, down, begin } from "./demo.js";
import { welcome } from "./card.js";
import { clear, remind } from "./state.js";
import { show } from "./coach.js";

export function init(view, cx) {
  setShared("tour.seen", true);
  view.handle.focus();
  cx.timer.after(300, () => view.handle.focus());
}

// Start: make the demo repo, hand New work its draft, open the first step's card.
export function advance(view, cx) {
  if (view.busy) return;
  view.busy = true;
  view.error = null;
  cx.notify();
  cx.spawn(async (cx) => {
    try {
      await down();
      await up();
    } catch (error) {
      view.busy = false;
      view.error = `Could not set up the demo: ${error.message ?? error}`;
      return cx.notify();
    }
    // A tour that still runs, or a dialog that went with a crash: neither leaves its state.
    clear();
    begin();
    show(STEPS[0]);
    closeOverlay(props().overlay);
  });
}

export function render(view, t) {
  return welcome(t, {
    stops: STEPS.filter((step) => !step.quiet).map((step) => step.title),
    busy: view.busy,
    error: view.error,
    handle: view.handle,
    onKey: (event, cx) => {
      if (event.key !== "enter") return;
      cx.stop_propagation();
      advance(view, cx);
    },
    onStart: (_event, cx) => advance(view, cx),
    onClose: () => remind() && closeOverlay(props().overlay),
  });
}
