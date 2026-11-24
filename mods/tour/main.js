// The tour: lasso in a few steps, in a demo repo with scripted agents (bin/lasso-tour-agent).
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
  exec,
  hc,
  nextCommand,
  checking,
} from "herdr";
import { bin, tourNudge } from "./lib/shared.js";
import { SPARK } from "./sparkle.js";
import { STEPS, world, progress } from "./steps.js";
import { up, down, demoRepo } from "./sandbox.js";
import { spot, point, real, main, under } from "./places.js";
import { welcome, coach, flight, shade, note, FADE } from "./card.js";

// What the New work dialog types by itself: a task, a model named twice (once misspelled on
// purpose: it is still picked), then a pasted ticket link in its place.
const TYPING = [
  { wait: 400 },
  { type: "Fix the checkout test that fails one run in ten" },
  { wait: 350 },
  { type: " with sonet" },
  { wait: 900 },
  { erase: 5 },
  { type: "opus" },
  { wait: 1300 },
  { paste: "https://linear.app/acme/issue/SHOP-42", say: "Pasting a link works too!" },
];
// What the tour types to the lead agent: a prompt from daily use (README, "Prompts that
// work"). No colon: `hc keys` has no key for one.
const ASK = "make sub issues for each repo, and make 2 children to implement";
// Types into a terminal: $1 the terminal, $5 on its keys, each one `hc` call (that is the pace).
// $4 is the last character: `hc send` pastes it and presses Enter (`hc keys` has no "?").
// With $3 it holds there instead, tells the card (tour.typed) and waits for your Enter.
// With a step in $2 it then waits until that agent has answered and tells the card (tour.ready).
const TYPE = `terminal=$1; step=$2; hold=$3; last=$4; shift 4; sleep 1.5
for key in "$@"; do hc keys $terminal $key >/dev/null || exit; done
sleep 0.7
if [[ -n $hold ]]; then
  herdr-app do tour.typed-$step >/dev/null
  until [[ $(hc get $terminal --json | jq -r .status) == working ]]; do sleep 0.3; done
else
  hc send $terminal "$last" >/dev/null
fi
[[ -n $step ]] || exit 0
sleep 1.5; hc wait $terminal >/dev/null; herdr-app do tour.ready-$step >/dev/null`;
// After Herdr starts, its window needs a moment before a dialog can open.
const OFFER_AFTER = 1500;
// "End the tour?" goes back to × after this long.
const CONFIRM = 3000;
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
  // Types the prompt into the lead's terminal, a key at a time as a person would, so you see
  // what was asked before the children show up. One shell command does it all: a command
  // that runs is not cut off when this card closes (a click outside the tour reopens it).
  children: ({ lead }) => type(lead?.address, ASK),
  steer: ({ children }) => type(children[0], "also cover the timeout case", "steer"),
  status: ({ lead }) => type(lead?.address, "status?", "status"),
  // Yours to send: the parent's pane gets the keyboard, so Enter goes there.
  tell: ({ lead }) => {
    if (lead) run("pane.focus", { terminal: lead.address });
    type(lead?.address, "address feedback for both", "tell", true);
  },
};

// Types `text` into a terminal and presses Enter, or with `hold` leaves the Enter to you.
function type(terminal, text, step = "", hold = false) {
  if (!terminal) return;
  const chars = [...text],
    last = hold ? "" : chars.pop(),
    keys = chars.map((char) => (char === " " ? "space" : char));
  exec("zsh", ["-c", TYPE, "tour-type", terminal, step, hold ? "hold" : "", last, ...keys]).catch(
    () => null,
  );
}

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
  if (hint) say(step);
}

// A note below the card: `text`, or that the tour is still running.
function say(step, text) {
  openOverlay({
    mod: "tour",
    kind: "window",
    frame: "none",
    at: under(step.card),
    props: { note: top(), text },
  });
}

function enter(step) {
  show(step);
  closeOverlay(props().overlay);
}

// Ends the tour's state: every veil lifts, its windows close themselves, and New work is
// its normal self again (clearing `newwork.open` closes the window the draft opened).
function clear() {
  for (const key of [
    "tour.step",
    "tour.spark",
    "tour.at",
    "tour.focus",
    "tour.said",
    "tour.ready",
    "tour.typed",
  ])
    setShared(key, null);
  setShared("newwork.draft", null);
  setShared("newwork.open", null);
}

function end(cx) {
  clear();
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
      // A card does not come back after a restart, so a tour ends with Herdr. Shared state
      // and the demo's agents outlive it: without this, ⌘⇧N would still open the tour's draft.
      if (shared("tour.step")) {
        clear();
        cx.spawn(() => down().catch(() => null));
      }
      if (!shared("tour.seen"))
        cx.timer.after(OFFER_AFTER, () => run("mod.open", { name: "tour" }));
      return;
    }
    // `tour.next` (⌘⇧. in keys.json) does what the shown button does: Start, Next or Done.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next") this.advance(cx);
        // The typing script: the agents have answered that step's prompt.
        if (command.startsWith("ready-")) setShared("tour.ready", command.slice(6));
        if (command.startsWith("typed-")) setShared("tour.typed", command.slice(6));
      }
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
        lit: true,
        repo: demoRepo(),
        agent: bin("lasso-tour-agent"),
      });
      run("layout.select", { stack: "work-stack", child: "work" });
      // The card and the sparkle sit beside the sidebar.
      run("layout.show", { id: "sidebar" });
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
      now = {
        ...world(terminals(), panes()),
        dialog: newWorkOpen(),
        // New work makes the worktree and starts the agent: it is not listed yet.
        starting: Boolean(shared("newwork.jobs")?.length),
        ready: shared("tour.ready") ?? null,
        typed: shared("tour.typed") ?? null,
      },
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

  // × asks once before it ends the tour: a slip would remove the demo mid-show.
  close(cx) {
    if (this.closing) return end(cx);
    this.closing = true;
    cx.notify();
    cx.timer.after(CONFIRM, (cx) => {
      this.closing = false;
      cx.notify();
    });
  }

  // What the shown button does: Start on the welcome dialog, Next or Finish on the card.
  advance(cx) {
    if (!props()?.card) return this.start(cx);
    const at = this.standing();
    // Step 1 waits for New work: the key opens it, then presses its Start.
    if (at?.step.id === "new-work" && !at.now.starting)
      return at.now.dialog
        ? setShared("newwork.start", true)
        : run("mod.open", { name: "new-work" });
    // The message that waits for your Enter: the key sends it.
    if (at?.step.id === "tell" && at.now.typed === "tell" && at.now.lead?.status === "idle")
      return hc(["keys", at.now.lead.address, "enter"]).catch(() => null);
    if (!at?.ready || at.step.auto) return;
    if (at.next) enter(at.next);
    else end(cx);
  }

  renderWelcome(t) {
    return welcome(t, {
      stops: STEPS.filter((step) => step.id !== "end" && !step.quiet).map((step) => step.title),
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

  renderNote(t) {
    // A newer click has a newer note, and what New work said goes with New work.
    const stale = props().text ? shared("newwork.say") !== props().text : top() !== props().note;
    if (!shared("tour.step") || stale) return closeOverlay(props().overlay) ?? div();
    return note(t, this.glows, props().text);
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
    // A card of an earlier step, such as one from a tour that was started again.
    if (!at) return closeOverlay(props().overlay) ?? div();
    if (at.step.auto && at.ready) return enter(at.next) ?? div();
    // The card opens again when the window was resized, at its place in the new size, and
    // when New work opens or you click outside the tour: the newest window is on top.
    if (
      !same(spot(at.step.card), props().at) ||
      newWorkOpen() !== props().over ||
      top() !== props().top
    ) {
      show(at.step, false, top() !== props().top);
      return closeOverlay(props().overlay) ?? div();
    }
    // What New work says while it types (its script's `say`) shows as a note below the card.
    const said = shared("newwork.say") ?? null;
    if (said !== (shared("tour.said") ?? null)) {
      setShared("tour.said", said);
      if (said) say(at.step, said);
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
      closing: this.closing,
      // For when the shortcut is out of reach: a click does the same.
      open: at.step.id === "new-work" &&
        !at.now.dialog &&
        !at.now.starting && { label: "Open it for me", action: (_event, cx) => this.advance(cx) },
      onClose: (_event, cx) => this.close(cx),
    });
  }
}
