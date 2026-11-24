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
import { spot, points, real, main, under } from "./places.js";
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
// With $3 it holds there instead, tells the card (tour.typed) and waits for your Enter: $3 is
// what the agent prints once it has the prompt.
// With a step in $2 it then waits until that agent has answered and tells the card (tour.ready).
const TYPE = `terminal=$1; step=$2; hold=$3; last=$4; shift 4; sleep 1.5
for key in "$@"; do hc keys $terminal $key >/dev/null || exit; done
sleep 0.7
if [[ -n $hold ]]; then
  herdr-app do tour.typed-$step >/dev/null
  hc wait $terminal --output "$hold" --timeout 600 >/dev/null
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
const HINT = 3000,
  SAID = 8000;
// How often a card looks whether the tour is still on.
const LOOK = 1500;
// The spring has settled by then.
const FLIGHT = 1000;
// Room around a flight for the spring's overshoot.
const OVERSHOOT = 24;
// Further sideways than this is another section: the sparkle does not fly, it fades in here.
const JUMP = 400;

const same = (a, b) => a?.x === b?.x && a?.y === b?.y;
const far = (a, b) => Math.abs(a.x - b.x) > JUMP;

// Opens a window for the sparkle: as big as what it must hold and no bigger, because a
// window takes the clicks on what is under it. `stars`: where each sparkle ends up. They all
// start at `from` and spring out, so one flies there, and several split from one.
// `fade`: they fade in. `top`: see `top()`. `group`: the target, when it has several places.
function fly(from, stars, fade, top, group) {
  const all = [from, ...stars],
    pad = all.every((star) => same(star, from)) ? 0 : OVERSHOOT,
    edge = (axis, pick) => pick(...all.map((star) => star[axis])),
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
        top,
        group,
        origin,
        width: edge("x", Math.max) + SPARK + pad - origin.x,
        height: edge("y", Math.max) + SPARK + pad - origin.y,
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
    type(lead?.address, "address feedback for both", "tell", "pass that on");
  },
};

// Types `text` into a terminal and presses Enter. With `hold` it leaves the Enter to you, and
// knows you pressed it when the agent prints that.
function type(terminal, text, step = "", hold = "") {
  if (!terminal) return;
  const chars = [...text],
    last = hold ? "" : chars.pop(),
    keys = chars.map((char) => (char === " " ? "space" : char));
  exec("zsh", ["-c", TYPE, "tour-type", terminal, step, hold, last, ...keys]).catch(() => null);
}

const newWorkOpen = () => Boolean(shared("newwork.open"));
// A press brings a window to the front, also the shade. Each click outside the tour counts
// this up (lib/tour.js), and the card and the sparkle open again on top of what was pressed.
const top = () => shared("tour.top") ?? 0;
// Counts the clicks that only need the note (a section's veil, Esc in New work).
const noted = () => shared("tour.noted") ?? 0;

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
    props: { card: true, step: step.id, at, fresh, top: top() },
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
    props: { note: top(), noted: noted(), text },
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
    "tour.acted",
    "tour.card",
    "tour.noted",
    "tour.noteShown",
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
      // A card for a new step fades in. One that opens again in place is just there.
      this.shows = !props().fresh;
      cx.timer.after(30, (cx) => {
        this.shows = true;
        cx.notify();
      });
      const step = STEPS.find((candidate) => candidate.id === props().step);
      if (props().fresh && !step?.act)
        cx.spawn(async () => ENTER[props().step]?.(world(terminals(), panes())));
      // A render cannot close a card that a reload brought back: this can.
      cx.timer.every(LOOK, () => !shared("tour.step") && closeOverlay(props().overlay));
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

  // The sparkles start where the one before was and spring to their places. A lone one that
  // has flown gets a window just its own size, so the flight's does not stay over the work.
  takeOff(cx) {
    const { from, stars, fade, top, group } = props().spark;
    this.out = false;
    this.glows = !fade;
    cx.timer.after(50, (cx) => {
      this.out = true;
      this.glows = true;
      cx.notify();
    });
    if (group || same(from, stars[0])) return;
    cx.timer.after(FLIGHT, () => fly(stars[0], stars, false, top));
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
    // The step's own button: now its entry work runs.
    if (at && !at.acted) {
      setShared("tour.acted", at.step.id);
      return ENTER[at.step.id]?.(at.now);
    }
    // The typed message that waits: now it is sent.
    if (at?.holds) return hc(["keys", at.now.lead.address, "enter"]).catch(() => null);
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
    const { from, stars, origin, width, height, group = null, top } = props().spark,
      at = shared("tour.at");
    if (
      !shared("tour.step") ||
      !same(at, stars[0]) ||
      at.top !== top ||
      (at.group ?? null) !== group
    )
      return closeOverlay(props().overlay) ?? div();
    return flight(t, {
      width,
      height,
      shown: this.glows,
      stars: stars
        .map((star) => (this.out ? star : from))
        .map(({ x, y }) => ({
          x: x - origin.x,
          y: y - origin.y,
        })),
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
    // What New work says stays longer than a nudge: it is there to be read.
    const stay = props().text ? SAID : HINT;
    cx.timer.after(stay, fade(false));
    cx.timer.after(stay + FADE, () => closeOverlay(props().overlay));
  }

  renderNote(t) {
    // A newer click has a newer note, and what New work said goes with New work.
    const stale = props().text
      ? shared("newwork.say") !== props().text
      : top() !== props().note || noted() !== props().noted;
    if (!shared("tour.step") || stale) return closeOverlay(props().overlay) ?? div();
    return note(t, this.glows, props().text);
  }

  renderShade(t) {
    if (shared("tour.step") !== props().shade) return closeOverlay(props().overlay) ?? div();
    const { whole } = props();
    return shade(t, { ...main(whole), whole, onPress: tourNudge });
  }

  render(cx) {
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
    // when a press brought the tour's dimmer to the front: the newest window is on top.
    if (!same(spot(at.step.card), props().at) || top() !== props().top) {
      show(at.step, false, top() !== props().top);
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
    if ((shared("tour.spark") ?? null) !== at.target) setShared("tour.spark", at.target);
    // Several places: the sparkle that is there splits into one for each.
    const stars = points(at.target, at.step.card),
      [to] = stars,
      group = stars.length > 1 ? at.target : null,
      from = shared("tour.at");
    if (to && (!same(from, to) || from.top !== top() || (from.group ?? null) !== group)) {
      const jump = !from || far(from, to);
      setShared("tour.at", { ...to, top: top(), group });
      fly(jump ? to : from, stars, jump, top(), group);
    }
    // One button, and `advance` does what it says. Step 1's is for when the shortcut is out
    // of reach, and goes once New work is open.
    const opening = at.step.id === "new-work",
      label = opening
        ? !at.now.dialog && !at.now.starting && "Open it for me"
        : !at.acted
          ? at.step.act
          : at.holds
            ? at.step.hold
            : at.next
              ? "Next"
              : "Done",
      action = label
        ? {
            label,
            enabled: opening || !at.acted || at.holds || at.ready,
            onPress: (_event, cx) => this.advance(cx),
          }
        : null;
    // A new status starts unseen and fades in a moment later.
    const status = JSON.stringify(at.progress);
    if (status !== this.asked) {
      this.asked = status;
      cx.timer.after(30, (cx) => {
        this.status = status;
        cx.notify();
      });
    }
    return coach(t, {
      step: at.step,
      index: at.index,
      count: STEPS.length,
      now: at.progress,
      fresh: this.status === status,
      action,
      closing: this.closing,
      shown: this.shows,
      onClose: (_event, cx) => this.close(cx),
      onSize: ({ height }) =>
        shared("tour.card")?.height !== Math.round(height) &&
        setShared("tour.card", { height: Math.round(height) }),
    });
  }
}
