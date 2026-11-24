// The tour: lasso in five steps, in a demo repo with scripted agents (bin/lasso-tour-agent).
// One mod, several kinds of copy. `mod.open tour` shows the welcome dialog. Its Start opens the
// coach card (props.card), a window you can drag: it shows the step in shared "tour.step" and
// moves the tour on. Each step opens a new card, next to what the step shows. The sparkle
// (props.spark) floats over the app in its own see-through window. The layout's copy draws
// nothing: it offers the tour once.
// steps.js has the steps and their rules, sandbox.js the demo repo, places.js where things
// are in the window, card.js the drawing.
//
// Shared state this mod writes:
//   tour.step      the step on the coach card, or null when no tour runs
//   tour.spark     what the sparkle points at (steps.js)
//   tour.at        where the sparkle floats, in layout px
//   tour.top       counts the clicks outside the tour (lib/tour.js writes it too)
//   tour.focus     the sections that stay clear while the others fade (lib/tour.js)
//   tour.seen      the welcome dialog has shown once
//   newwork.draft  what the New work dialog types by itself (mods/new-work reads and clears it)
// It reads newwork.open (the New work dialog is open) and clears it at the tour's start and
// end, and it reads tour.row (mods/tasks: where the sparkle's sidebar row is).
import { View, div } from "gpui-kit";
import {
  props,
  openOverlay,
  closeOverlay,
  theme,
  shared,
  setShared,
  panes,
  terminals,
  run,
  hc,
  nextCommand,
  checking,
} from "herdr";
import { bin, SPARK, tourNudge } from "./lib/shared.js";
import { STEPS, world, progress } from "./steps.js";
import { up, down, demoRepo } from "./sandbox.js";
import { spot, point, real, main, under } from "./places.js";
import { welcome, coach, flight, shade, note, FADE } from "./card.js";

// What the New work dialog types by itself: the task, then three ways to name a model. Two
// are misspelled on purpose, to show that the dialog still picks the model.
const TYPING = [
  { wait: 400 },
  { type: "Fix the checkout test that fails one run in ten" },
  { wait: 350 },
  { type: " with sonet" },
  { wait: 900 },
  { erase: 5 },
  { type: "hku" },
  { wait: 900 },
  { erase: 3 },
  { type: "opus" },
];
const ASK = "make 2 children: one writes a failing test, one fixes the retry";
// After Herdr starts, its window needs a moment before a dialog can open.
const OFFER_AFTER = 1500;
// The note below the card stays this long.
const HINT = 3000;
// The sparkle stays this long on each Context section.
const BEAT = 1500;
// The spring has settled by then.
const FLIGHT = 1000;
// Room around a flight for the spring's overshoot.
const OVERSHOOT = 24;
// Further sideways than this is another section: the sparkle does not fly, it fades in here.
const JUMP = 400;

const same = (a, b) => a?.x === b?.x && a?.y === b?.y;
const far = (a, b) => Math.abs(a.x - b.x) > JUMP;

// Opens the sparkle's window: as big as the way from `from` to `to`, and no bigger, because
// a window takes the clicks on what is under it. `fade`: it fades in. `top`: see `top()`.
function fly(from, to, fade, top) {
  const pad = same(from, to) ? 0 : OVERSHOOT,
    origin = {
      x: Math.max(0, Math.min(from.x, to.x) - pad),
      y: Math.max(0, Math.min(from.y, to.y) - pad),
    };
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    at: real(origin),
    props: {
      spark: {
        from,
        to,
        fade,
        top,
        origin,
        width: Math.max(from.x, to.x) + SPARK + pad - origin.x,
        height: Math.max(from.y, to.y) + SPARK + pad - origin.y,
      },
    },
  });
}

// What the tour does on the way into a step. The step's new card runs it: the old card
// closes at once, and closing a copy cancels what it still runs.
const ENTER = {
  // New work opens in the background: bring the new agent to the front.
  title: ({ lead }) => {
    if (!lead) return;
    run("space.select", { id: lead.labels?.["herdr.space"] });
    run("pane.focus", { terminal: lead.address });
  },
  context: () => {
    run("layout.select", { stack: "panel-body", child: "context" });
    run("layout.show", { id: "panel" });
  },
  children: ({ lead }) => {
    if (lead) return hc(["send", lead.address, ASK]).catch(() => null);
  },
};

const newWorkOpen = () => Boolean(shared("newwork.open"));
// A press brings a window to the front, also the shade. Each click outside the tour counts
// this up (lib/tour.js), and the card and the sparkle open again on top of what was pressed.
const top = () => shared("tour.top") ?? 0;

// Opens the card for a step. Without a `key`, so a card you dragged does not pin the next one.
// `fresh`: the tour enters the step now. Not when a card only opens again at a new place.
// `hint`: a note opens below it (card.js).
function show(step, fresh = true, hint = false) {
  setShared("tour.step", step.id);
  setShared("tour.focus", step.focus ?? null);
  // First, so the card opens above it: mods fade themselves, only a window can fade terminals.
  if (fresh && step.focus && !step.focus.includes("main")) {
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
  const at = spot(step.card);
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    props: { card: true, step: step.id, at, fresh, over: newWorkOpen(), top: top() },
    at,
  });
  if (hint)
    openOverlay({
      mod: "tour",
      kind: "window",
      frame: "none",
      at: under(step.card),
      props: { note: top() },
    });
}

function enter(step) {
  show(step);
  closeOverlay(props().overlay);
}

function end(cx) {
  setShared("tour.step", null);
  setShared("tour.spark", null);
  setShared("tour.at", null);
  setShared("tour.focus", null);
  setShared("newwork.draft", null);
  // Closes the New work window the tour's draft opened, if it is still up.
  setShared("newwork.open", null);
  closeOverlay(props().overlay);
  cx.spawn(() => down().catch(() => null));
}

export default class Tour extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (checking()) return;
    if (props()?.spark) return this.takeOff(cx);
    if (props()?.shade) return;
    if (props()?.note !== undefined) return this.say(cx);
    if (props()?.card) {
      if (props().fresh) cx.spawn(async () => ENTER[props().step]?.(world(terminals(), panes())));
      this.beat = 0;
      cx.timer.every(BEAT, (cx) => {
        // A render cannot close a card that a reload brought back: this can.
        if (!shared("tour.step")) return closeOverlay(props().overlay);
        this.beat++;
        cx.notify();
      });
    } else if (props()?.overlay) {
      setShared("tour.seen", true);
      this.handle.focus();
      cx.timer.after(300, () => this.handle.focus());
    } else {
      // A card does not come back after a restart, so a tour ends with Herdr.
      setShared("tour.step", null);
      setShared("tour.at", null);
      if (!shared("tour.seen"))
        cx.timer.after(OFFER_AFTER, () => run("mod.open", { name: "tour" }));
      return;
    }
    // `tour.next` does what the shown button does (Start, Next or Finish): bind it to a key.
    cx.spawn(async (cx) => {
      for (;;) if ((await nextCommand()) === "next") this.advance(cx);
    });
  }

  // The sparkle starts where it was and springs to its new place. Once there, a window just
  // its own size takes over, so the flight's window does not stay over the work.
  takeOff(cx) {
    const { from, to, fade } = props().spark;
    this.at = from;
    this.glows = !fade;
    if (fade)
      cx.timer.after(50, (cx) => {
        this.glows = true;
        cx.notify();
      });
    if (same(from, to)) return;
    cx.timer.after(50, (cx) => {
      this.at = to;
      cx.notify();
    });
    cx.timer.after(FLIGHT, () => fly(to, to, false, props().spark.top));
    cx.timer.after(FLIGHT + 150, () => closeOverlay(props().overlay));
  }

  // The welcome dialog: make the demo repo, hand New work its draft, start the first step.
  start(cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await down();
        await up();
      } catch (error) {
        this.busy = false;
        this.error = `Could not set up the demo: ${error.message ?? error}`;
        return cx.notify();
      }
      // A dialog that went with a crash may have left this on.
      setShared("newwork.open", null);
      setShared("newwork.draft", {
        script: TYPING,
        lit: "dimmed",
        repo: demoRepo(),
        agent: bin("lasso-tour-agent"),
      });
      run("layout.select", { stack: "work-stack", child: "work" });
      show(STEPS[0]);
      closeOverlay(props().overlay);
    });
  }

  // Where the tour stands: null when this copy is not the card of the step that is on.
  standing() {
    const mine = props()?.card && props().step === shared("tour.step"),
      index = mine ? STEPS.findIndex((step) => step.id === props().step) : -1;
    if (index < 0) return null;
    const step = STEPS[index],
      now = { ...world(terminals(), panes()), dialog: newWorkOpen() },
      progressNow = progress(step, now);
    return {
      index,
      step,
      now,
      next: STEPS[index + 1],
      progress: progressNow,
      ready: !progressNow || progressNow.tone === "ok",
      target: step.spark?.(now, this.beat) ?? null,
    };
  }

  // What the shown button does: Start on the welcome dialog, Next or Finish on the card.
  advance(cx) {
    if (!props()?.card) return this.start(cx);
    const at = this.standing();
    if (!at?.ready || at.step.auto) return;
    if (at.next) enter(at.next);
    else end(cx);
  }

  renderWelcome(t) {
    return welcome(t, {
      stops: STEPS.filter((step) => step.id !== "end").map((step) => step.title),
      busy: this.busy,
      error: this.error,
      handle: this.handle,
      onKey: (event, cx) => {
        if (event.key !== "enter") return;
        cx.stop_propagation();
        this.start(cx);
      },
      onStart: (_event, cx) => this.start(cx),
      onClose: () => closeOverlay(props().overlay),
    });
  }

  // Only render may ask whether the sparkle is still the tour's: a timer reads shared state
  // from before the change.
  renderSpark(t) {
    const { to, origin, width, height } = props().spark,
      at = shared("tour.at");
    if (!shared("tour.step") || !same(at, to) || at.top !== props().spark.top)
      return closeOverlay(props().overlay) ?? div();
    return flight(t, {
      width,
      height,
      shown: this.glows,
      to: { x: this.at.x - origin.x, y: this.at.y - origin.y },
    });
  }

  // The note fades in, stays, fades out and goes.
  say(cx) {
    this.glows = false;
    const fade = (on) => (cx) => {
      this.glows = on;
      cx.notify();
    };
    cx.timer.after(50, fade(true));
    cx.timer.after(HINT, fade(false));
    cx.timer.after(HINT + FADE, () => closeOverlay(props().overlay));
  }

  // A newer click has a newer note.
  renderNote(t) {
    if (!shared("tour.step") || top() !== props().note)
      return closeOverlay(props().overlay) ?? div();
    return note(t, this.glows);
  }

  renderShade(t) {
    if (shared("tour.step") !== props().shade) return closeOverlay(props().overlay) ?? div();
    const { whole } = props();
    return shade(t, { ...main(whole), whole, onPress: tourNudge });
  }

  render() {
    const t = theme();
    if (props()?.spark) return this.renderSpark(t);
    if (props()?.shade) return this.renderShade(t);
    if (props()?.note !== undefined) return this.renderNote(t);
    if (!props()?.card) return props()?.overlay ? this.renderWelcome(t) : div();
    if (!shared("tour.step")) return closeOverlay(props().overlay) ?? div();
    const at = this.standing();
    if (!at) return div();
    if (at.step.auto && at.ready) enter(at.next);
    // The card opens again when the window was resized, at its place in the new size, and
    // when New work opens or you click outside the tour: the newest window is on top.
    else if (
      !same(spot(at.step.card), props().at) ||
      newWorkOpen() !== props().over ||
      top() !== props().top
    ) {
      show(at.step, false, top() !== props().top);
      return closeOverlay(props().overlay) ?? div();
    }
    if ((shared("tour.spark") ?? null) !== at.target) setShared("tour.spark", at.target);
    const to = point(at.target, at.step.card),
      from = shared("tour.at");
    if (to && (!same(from, to) || from.top !== top())) {
      const jump = !from || far(from, to);
      setShared("tour.at", { ...to, top: top() });
      fly(jump || same(from, to) ? to : from, to, jump, top());
    }
    return coach(t, {
      step: at.step,
      index: at.index,
      count: STEPS.length,
      progress: at.progress,
      last: !at.next,
      onNext: (_event, cx) => this.advance(cx),
      onClose: (_event, cx) => end(cx),
    });
  }
}
