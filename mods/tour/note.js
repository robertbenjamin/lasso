// The note's window (props.note): a word below the card, which fades in, stays and goes.
// card.js draws it.
import { div } from "gpui-kit";
import { props, openOverlay, closeOverlay, shared } from "herdr";
import { under } from "./places.js";
import { note, FADE } from "./card.js";
import { nudges, noted } from "./state.js";

// The note stays this long: a nudge, or what New work said, which is there to be read.
const HINT = 3000,
  SAID = 8000;

// A note below the card: `text`, or that the tour is still running.
export function say(step, text) {
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    at: under(step.card),
    props: { note: nudges(), noted: noted(), text },
  });
}

export function init(view, cx) {
  view.glows = false;
  const fade = (on) => (cx) => {
    view.glows = on;
    cx.notify();
  };
  cx.timer.after(50, fade(true));
  const stay = props().text ? SAID : HINT;
  cx.timer.after(stay, fade(false));
  cx.timer.after(stay + FADE, () => closeOverlay(props().overlay));
}

export function render(view, t) {
  // A newer click has a newer note, and what New work said goes with New work.
  const stale = props().text
    ? shared("newwork.say") !== props().text
    : nudges() !== props().note || noted() !== props().noted;
  if (!shared("tour.step") || stale) return closeOverlay(props().overlay) ?? div();
  return note(t, view.glows, props().text);
}
