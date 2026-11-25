// The step's card (props.card): a window you can drag. It shows the step in shared
// "tour.step", moves the tour on, and opens the shade, the sparkle and the notes. Each step
// opens a new card, next to what the step shows. card.js draws it.
import { div } from "gpui-kit";
import { props, openOverlay, closeOverlay, shared, setShared, panes, terminals, hc } from "herdr";
import { STEPS, world, progress } from "./steps.js";
import { down, restore, ENTER, PRESS } from "./demo.js";
import { spot, points, same } from "./places.js";
import { coach, FADE } from "./card.js";
import { clear, remind, nudges, noted } from "./state.js";
import { fly, far } from "./flight.js";
import { dim } from "./shade.js";
import { say } from "./note.js";

// "End the tour?" goes back to × after this long.
const CONFIRM = 3000;
// How often a card looks whether the tour is still on.
const LOOK = 1500;

// Opens the card for a step. Without a `key`, so a card you dragged does not pin the next one.
// `fresh`: the tour enters the step now. Not when a card only opens again at a new place.
// `hint`: a note opens below it.
export function show(step, fresh = true, hint = false) {
  setShared("tour.step", step.id);
  setShared("tour.focus", step.focus ?? null);
  // First, so the card opens above it.
  if (fresh) dim(step);
  const at = spot(step.card);
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    props: { card: true, step: step.id, at, fresh, nudges: nudges() },
    at,
  });
  if (hint) say(step);
}

function enter(step) {
  show(step);
  closeOverlay(props().overlay);
}

function end(cx) {
  restore();
  clear();
  remind();
  closeOverlay(props().overlay);
  cx.spawn(() => down().catch(() => null));
}

export function init(view, cx) {
  // A card for a new step fades in. One that opens again in place is just there.
  view.shows = !props().fresh;
  cx.timer.after(30, (cx) => {
    view.shows = true;
    cx.notify();
  });
  // The new card runs the step's entry work: the old card closes at once, and closing a copy
  // cancels what it still runs.
  const step = STEPS.find((candidate) => candidate.id === props().step);
  if (props().fresh && !step?.act)
    cx.spawn(async () => ENTER[props().step]?.(world(terminals(), panes())));
  // A render cannot close a card that a reload brought back: this can.
  cx.timer.every(LOOK, () => !shared("tour.step") && closeOverlay(props().overlay));
}

// Where the tour stands: null when this card is not the one of the step that is on.
function standing() {
  const mine = props().step === shared("tour.step"),
    index = mine ? STEPS.findIndex((step) => step.id === props().step) : -1;
  if (index < 0) return null;
  const step = STEPS[index],
    now = {
      ...world(terminals(), panes()),
      dialog: Boolean(shared("newwork.open")),
      // New work took the draft at its Start: the agent is on its way, not listed yet.
      // Not `newwork.jobs`: a failed job of yours stays in that list.
      starting: !shared("newwork.draft"),
      ready: shared("tour.ready") ?? null,
      typed: shared("tour.typed") ?? null,
    },
    // A step with `act` waits for its button: until then it shows and points at nothing.
    acted = !step.act || shared("tour.acted") === step.id;
  return {
    index,
    step,
    now,
    acted,
    // Its prompt is typed and the agent still sits at it.
    holds:
      Boolean(step.hold) &&
      now.typed === step.id &&
      now.ready !== step.id &&
      now.lead?.status === "idle",
    next: STEPS[index + 1],
    progress: acted ? progress(step, now) : null,
    ready: acted && (!step.done || Boolean(step.done(now))),
    target: (acted && step.spark?.(now)) || null,
  };
}

// × asks once before it ends the tour: a slip would remove the demo mid-show.
export function close(view, cx) {
  if (view.closing) return leave(view, cx, (cx) => end(cx));
  view.closing = true;
  cx.notify();
  cx.timer.after(CONFIRM, (cx) => {
    view.closing = false;
    cx.notify();
  });
}

// What the card's button and `tour.next` do: Next or Done, or the step's own button.
export function advance(view, cx) {
  const at = standing();
  if (at && PRESS[at.step.id]?.(at.now)) return;
  // The step's own button: now its entry work runs.
  if (at && !at.acted) {
    setShared("tour.acted", at.step.id);
    return ENTER[at.step.id]?.(at.now);
  }
  // The typed message that waits: now it is sent.
  if (at?.holds) return hc(["keys", at.now.lead.address, "enter"]).catch(() => null);
  if (!at?.ready || at.step.auto) return;
  leave(view, cx, at.next ? () => enter(at.next) : (cx) => end(cx));
}

// The card fades out, then `then` runs: the next card, or the tour's end.
function leave(view, cx, then) {
  if (view.leaves) return;
  view.leaves = true;
  view.shows = false;
  cx.notify();
  cx.timer.after(FADE, then);
}

export function render(view, t, cx) {
  if (!shared("tour.step")) return closeOverlay(props().overlay) ?? div();
  const at = standing();
  // A card of an earlier step, such as one from a tour that was started again.
  if (!at) return closeOverlay(props().overlay) ?? div();
  // A step that moves on by itself fades out first, as one left with its button does.
  if (at.step.auto && at.ready && !view.auto) {
    view.auto = true;
    cx.timer.after(FADE, () => enter(at.next));
  }
  // The card opens again when the window was resized, at its place in the new size, and
  // when a press brought one of the tour's windows to the front: the newest window is on top.
  if (!same(spot(at.step.card), props().at) || nudges() !== props().nudges) {
    show(at.step, false, nudges() !== props().nudges);
    return closeOverlay(props().overlay) ?? div();
  }
  // A click that the tour blocked: the note says why nothing happened.
  if (noted() !== (shared("tour.noteShown") ?? 0)) {
    setShared("tour.noteShown", noted());
    say(at.step);
  }
  // What New work says while it types (its script's `say`) shows as a note below the card.
  const said = shared("newwork.say") ?? null;
  if (said !== (shared("tour.said") ?? null)) {
    setShared("tour.said", said);
    if (said) say(at.step, said);
  }
  follow(at);
  return coach(t, {
    step: at.step,
    index: at.index,
    count: STEPS.length,
    ...status(view, at, cx),
    action: button(view, at),
    closing: view.closing,
    shown: view.shows && !view.auto,
    onClose: (_event, cx) => close(view, cx),
    onSize: ({ height }) =>
      shared("tour.card")?.height !== Math.round(height) &&
      setShared("tour.card", { height: Math.round(height) }),
  });
}

// The sparkle goes where the step points. Several places: the one that is there splits into
// one for each.
function follow(at) {
  if ((shared("tour.spark") ?? null) !== at.target) setShared("tour.spark", at.target);
  const stars = points(at.target, at.step.card),
    [to] = stars,
    group = stars.length > 1 ? at.target : null,
    from = shared("tour.at");
  if (to && (!same(from, to) || from.nudges !== nudges() || (from.group ?? null) !== group)) {
    const jump = !from || far(from, to);
    setShared("tour.at", { ...to, nudges: nudges(), group });
    fly(jump ? to : from, stars, jump, nudges(), group);
  }
}

// One button, and `advance` does what it says.
function button(view, at) {
  const own = Boolean(at.step.button),
    label = own
      ? at.step.button(at.now)
      : !at.acted
        ? at.step.act
        : at.holds
          ? at.step.hold
          : at.next
            ? "Next"
            : "Done";
  if (!label) return null;
  return {
    label,
    enabled: own || !at.acted || at.holds || at.ready,
    onPress: (_event, cx) => advance(view, cx),
  };
}

// A status goes out before the next one comes in: the old one fades, then the text changes,
// then the new one fades in.
function status(view, at, cx) {
  const status = JSON.stringify(at.progress);
  if (status !== view.asked) {
    view.asked = status;
    const next = at.progress;
    cx.timer.after(view.told ? 120 : 0, (cx) => {
      view.now = next;
      view.told = status;
      cx.notify();
    });
    cx.timer.after(view.told ? 150 : 30, (cx) => {
      view.fresh = status;
      cx.notify();
    });
  }
  return { now: view.now ?? null, fresh: view.fresh === status && view.told === status };
}
