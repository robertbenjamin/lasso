// The tour: lasso in five steps, in a demo repo with scripted agents (bin/lasso-tour-agent).
// One mod, three copies. `mod.open tour` shows the welcome dialog. Its Start opens the coach
// card (props.card), a window you can drag: it shows the step in shared "tour.step" and moves
// the tour on. Each step opens a new card, next to what the step shows. The layout's copy
// draws nothing: it offers the tour once.
// steps.js has the steps and their rules, sandbox.js the demo repo, card.js the drawing.
//
// Shared state this mod writes:
//   tour.step      the step on the coach card, or null when no tour runs
//   tour.spark     the one thing the sparkle sits beside (lib/tour.js)
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
  layout,
} from "herdr";
import { bin, find } from "./lib/shared.js";
import { STEPS, world, progress } from "./steps.js";
import { up, down, demoRepo } from "./sandbox.js";
import { welcome, coach, CARD_WIDTH } from "./card.js";

const TASK = "Fix the flaky checkout test";
const ASK = "make 2 children: one writes a failing test, one fixes the retry";
// After Herdr starts, its window needs a moment before a dialog can open.
const OFFER_AFTER = 1500;
// The sparkle stays this long on each Context section.
const BEAT = 1500;
const MARGIN = 16;

// The card's top left for a step: beside the Agents list, beside the Context panel, or
// (undefined) the middle. Herdr gives no element positions, so this reads the layout's sizes.
function spot(place) {
  const root = layout(),
    { width, height } = globalThis.window.viewport_size(),
    px = (id) => find(root, id)?.size?.px ?? 0,
    weight = (id) => find(root, id)?.size?.weight ?? 1;
  if (place === "panel") return { x: width - px("panel") - CARD_WIDTH - 3 * MARGIN, y: 96 };
  if (place !== "agents") return undefined;
  const top = px("brand") + px("work-nav"),
    lists = height - top - px("sidebar-footer"),
    spaces = (lists * weight("spaces")) / (weight("spaces") + weight("agents"));
  return { x: px("sidebar") + MARGIN, y: top + spaces + MARGIN };
}

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

// Opens the card for a step. Without a `key`, so a card you dragged does not pin the next one.
function show(step) {
  setShared("tour.step", step.id);
  openOverlay({ mod: "tour", kind: "window", props: { card: true }, at: spot(step.card) });
}

function enter(step, now) {
  ENTER[step.id]?.(now);
  show(step);
  closeOverlay(props().overlay);
}

function end(cx) {
  setShared("tour.step", null);
  setShared("tour.spark", null);
  setShared("newwork.draft", null);
  closeOverlay(props().overlay);
  cx.spawn(() => down().catch(() => null));
}

export default class Tour extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (checking()) return;
    if (props()?.card) {
      this.beat = 0;
      cx.timer.every(BEAT, (cx) => {
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
      if (!shared("tour.seen"))
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
      show(STEPS[0]);
      closeOverlay(props().overlay);
    });
  }

  // Tells the other mods where the sparkle sits, when that changes.
  point(target) {
    if (target === this.pointed) return;
    this.pointed = target;
    setShared("tour.spark", target);
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
    if (index < 0) return closeOverlay(props().overlay) ?? div();
    const step = STEPS[index],
      next = STEPS[index + 1],
      now = world(terminals(), panes()),
      standing = progress(step, now);
    if (step.auto && standing.tone === "ok") enter(next, now);
    const target = step.spark?.(now, this.beat) ?? standing?.act ?? null;
    this.point(target);
    return coach(t, {
      step,
      index,
      count: STEPS.length,
      progress: standing,
      last: !next,
      nudge: !step.auto && !target && (!standing || standing.tone === "ok"),
      onNext: (_event, cx) => (next ? enter(next, now) : end(cx)),
      onClose: (_event, cx) => end(cx),
    });
  }
}
