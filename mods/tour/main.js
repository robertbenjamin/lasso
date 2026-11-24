// The tour: lasso in five steps, in a demo repo with scripted agents (bin/lasso-tour-agent).
// One mod, three copies. `mod.open tour` shows the welcome dialog. Its Start opens the coach
// card (props.card), a window in the middle that you can drag: it shows the step in shared
// "tour.step" and moves the tour on. The layout's copy draws nothing: it offers the tour once.
// steps.js has the steps and their rules, sandbox.js the demo repo, card.js the drawing.
//
// Shared state this mod writes:
//   tour.step      the step on the coach card, or null when no tour runs
//   tour.focus     { glow, act }: the sections that glow and where the spark sits (lib/tour.js)
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
  checking,
} from "herdr";
import { bin } from "./lib/shared.js";
import { STEPS, world, progress } from "./steps.js";
import { up, down, demoRepo } from "./sandbox.js";
import { welcome, coach } from "./card.js";

const TASK = "Fix the flaky checkout test";
const CARD = { card: true };
const ASK = "make 2 children: one writes a failing test, one fixes the retry";
// After Herdr starts, its window needs a moment before a dialog can open.
const OFFER_AFTER = 1500;

// What the tour does on the way into a step.
const ENTER = {
  // New work opens in the background: bring the new agent to the front.
  title: ({ lead }) => {
    run("space.select", { id: lead.labels?.["herdr.space"] });
    run("pane.focus", { terminal: lead.address });
  },
  context: () => {
    run("layout.select", { stack: "panel-body", child: "context" });
    run("layout.show", { id: "panel" });
  },
  children: ({ lead }) => {
    if (lead) hc(["send", lead.address, ASK]).catch(() => null);
  },
};

function enter(step, now) {
  ENTER[step.id]?.(now);
  setShared("tour.step", step.id);
}

function end(cx) {
  setShared("tour.step", null);
  setShared("tour.focus", null);
  setShared("newwork.draft", null);
  closeOverlay(props().overlay);
  cx.spawn(() => down().catch(() => null));
}

export default class Tour extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (checking()) return;
    if (props()?.card) return;
    if (props()?.overlay) {
      setShared("tour.seen", true);
      this.handle.focus();
      cx.timer.after(300, () => this.handle.focus());
    } else if (!shared("tour.seen")) {
      cx.timer.after(OFFER_AFTER, () => run("mod.open", { name: "tour" }));
    }
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
      setShared("tour.step", STEPS[0].id);
      // `key`: the card opens again where you dropped it, and comes back after a restart.
      openOverlay({ mod: "tour", kind: "window", key: "tour-card", keep: true, props: CARD });
      closeOverlay(props().overlay);
    });
  }

  // Tells the other mods what glows and where the spark sits, when that changes.
  point(step, standing) {
    const act = !standing || standing.tone === "ok" ? null : (standing.act ?? null),
      focus = { glow: step.glow ?? [], act },
      key = JSON.stringify(focus);
    if (key === this.pointed) return;
    this.pointed = key;
    setShared("tour.focus", focus);
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

  render() {
    const t = theme();
    if (!props()?.card) return props()?.overlay ? this.renderWelcome(t) : div();
    const index = STEPS.findIndex((step) => step.id === shared("tour.step"));
    if (index < 0) return div();
    const step = STEPS[index],
      next = STEPS[index + 1],
      now = world(terminals(), panes()),
      standing = progress(step, now);
    if (step.auto && standing.tone === "ok") enter(next, now);
    this.point(step, standing);
    return coach(t, {
      step,
      index,
      count: STEPS.length,
      progress: standing,
      last: !next,
      onNext: (_event, cx) => (next ? enter(next, now) : end(cx)),
      onClose: (_event, cx) => end(cx),
    });
  }
}
