// The tour: lasso in a few steps, in a demo repo with scripted agents (bin/lasso-tour-agent).
// One mod, a copy for each role, told apart by its props:
//   the engine    welcome.js (the dialog), coach.js (the step's card), flight.js (the sparkle),
//                 shade.js, note.js, type.js (typing into a terminal); card.js and sparkle.js
//                 draw; state.js lists the shared state
//   this tour     steps.js (what each step says and waits for), demo.js (what it does),
//                 places.js (where things are in lasso's window)
// The layout's copy draws nothing: it offers the tour once.
import { View, div } from "gpui-kit";
import { props, theme, shared, setShared, run, nextCommand, checking } from "herdr";
import { down } from "./demo.js";
import { clear } from "./state.js";
import * as welcome from "./welcome.js";
import * as coach from "./coach.js";
import * as flight from "./flight.js";
import * as shade from "./shade.js";
import * as note from "./note.js";

// After Herdr starts, its window needs a moment before a dialog can open.
const OFFER_AFTER = 1500;

// Each role is a module of plain functions that get this view: init, render, and advance
// for the two with a button.
function roleOf(given) {
  if (given?.spark) return flight;
  if (given?.shade) return shade;
  if (given?.note !== undefined) return note;
  if (given?.card) return coach;
  return given?.overlay ? welcome : null;
}

// A card does not come back after a restart, so a tour ends with Herdr. Shared state and the
// demo's agents outlive it: without this, ⌘⇧N would still open the tour's draft.
function offer(cx) {
  if (shared("tour.step")) {
    clear();
    cx.spawn(() => down().catch(() => null));
  }
  if (!shared("tour.seen")) cx.timer.after(OFFER_AFTER, () => run("mod.open", { name: "tour" }));
}

export default class Tour extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (checking()) return;
    const role = roleOf(props());
    if (!role) return offer(cx);
    role.init(this, cx);
    if (!role.advance) return;
    // `tour.next` (⌘⇧. in keys.json) does what the shown button does: Start, Next or Done.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "next") role.advance(this, cx);
        // The typing script (type.js): a step's prompt is typed, or answered.
        if (command.startsWith("ready-")) setShared("tour.ready", command.slice(6));
        if (command.startsWith("typed-")) setShared("tour.typed", command.slice(6));
      }
    });
  }

  // Herdr calls close() once when any copy goes. It was the card's × handler too, so it still
  // runs that: a card that goes within CONFIRM of a first × press ends the tour.
  close(cx) {
    coach.close(this, cx);
  }

  render(cx) {
    const t = theme(),
      role = roleOf(props());
    return role ? role.render(this, t, cx) : div();
  }
}
