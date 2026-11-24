// The tour: lasso in five steps, in a demo repo with scripted agents (bin/lasso-tour-agent).
// One mod, four kinds of copy. `mod.open tour` shows the welcome dialog. Its Start opens the
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
//   tour.focus     the sections that stay clear while the others fade (lib/tour.js)
//   tour.seen      the welcome dialog has shown once
//   newwork.draft  what the New work dialog opens with (mods/new-work reads and clears it)
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
import { bin, SPARK } from "./lib/shared.js";
import { STEPS, world, progress } from "./steps.js";
import { up, down, demoRepo } from "./sandbox.js";
import { spot, point, real } from "./places.js";
import { welcome, coach, flight } from "./card.js";

const TASK = "Fix the flaky checkout test";
const ASK = "make 2 children: one writes a failing test, one fixes the retry";
// After Herdr starts, its window needs a moment before a dialog can open.
const OFFER_AFTER = 1500;
// The sparkle stays this long on each Context section.
const BEAT = 1500;
// The spring has settled by then.
const FLIGHT = 1000;
// Room around a flight for the spring's overshoot.
const OVERSHOOT = 24;
// Further sideways than this is another section: the sparkle fades out there and in here.
const JUMP = 400;
// How often a sparkle looks whether it is still the tour's: it has faded out by then.
const POLL = 400;

const same = (a, b) => a?.x === b?.x && a?.y === b?.y;
const far = (a, b) => Math.abs(a.x - b.x) > JUMP;

// Opens the sparkle's window: as big as the way from `from` to `to`, and no bigger, because
// a window takes the clicks on what is under it. `fade`: it fades in.
function fly(from, to, fade) {
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

// Opens the card for a step. Without a `key`, so a card you dragged does not pin the next one.
// `fresh`: the tour enters the step now. Not when a card only opens again at a new place.
function show(step, fresh = true) {
  setShared("tour.step", step.id);
  setShared("tour.focus", step.focus ?? null);
  const at = spot(step.card);
  openOverlay({
    mod: "tour",
    kind: "window",
    props: { card: true, step: step.id, at, fresh },
    at,
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
  closeOverlay(props().overlay);
  cx.spawn(() => down().catch(() => null));
}

export default class Tour extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (checking()) return;
    if (props()?.spark) return this.takeOff(cx);
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
    cx.timer.every(POLL, () => this.gone() && closeOverlay(props().overlay));
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
    cx.timer.after(FLIGHT, () => fly(to, to, false));
    cx.timer.after(FLIGHT + 150, () => closeOverlay(props().overlay));
  }

  // The tour ended, or its sparkle is somewhere else now.
  gone() {
    return !shared("tour.step") || !same(shared("tour.at"), props().spark.to);
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
      setShared("newwork.draft", {
        text: TASK,
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
      now = world(terminals(), panes()),
      progressNow = progress(step, now);
    return {
      index,
      step,
      now,
      next: STEPS[index + 1],
      progress: progressNow,
      ready: !progressNow || progressNow.tone === "ok",
      target: step.spark?.(now, this.beat) ?? progressNow?.act ?? null,
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

  renderSpark(t) {
    const { to, origin, width, height } = props().spark,
      gone = this.gone(),
      next = shared("tour.at");
    // A flight from here took over: gone at once. After a jump, or the end: it fades out.
    if (gone && next && !far(next, to)) return closeOverlay(props().overlay) ?? div();
    return flight(t, {
      width,
      height,
      shown: this.glows && !gone,
      to: { x: this.at.x - origin.x, y: this.at.y - origin.y },
    });
  }

  render() {
    const t = theme();
    if (props()?.spark) return this.renderSpark(t);
    if (!props()?.card) return props()?.overlay ? this.renderWelcome(t) : div();
    if (!shared("tour.step")) return closeOverlay(props().overlay) ?? div();
    const at = this.standing();
    if (!at) return div();
    if (at.step.auto && at.ready) enter(at.next);
    // The window was resized: the card opens again at its place in the new size.
    else if (!same(spot(at.step.card), props().at)) {
      show(at.step, false);
      return closeOverlay(props().overlay) ?? div();
    }
    if ((shared("tour.spark") ?? null) !== at.target) setShared("tour.spark", at.target);
    const to = point(at.target, at.step.card),
      from = shared("tour.at");
    if (!same(from, to)) {
      const jump = !from || far(from, to);
      setShared("tour.at", to);
      fly(jump ? to : from, to, jump);
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
