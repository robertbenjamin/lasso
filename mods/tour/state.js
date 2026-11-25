// The tour's shared state. Its copies write:
//   tour.step                the step on the card, or null when no tour runs (every veil reads it)
//   tour.focus               the sections that stay clear while the others fade (lib/tour.js)
//   tour.spark               what the sparkle points at (steps.js; mods/tasks reads it)
//   tour.at                  where the sparkle floats, in layout px
//   tour.card                the card's height, in real px (places.js)
//   tour.acted               the step whose `act` button was pressed
//   tour.typed, tour.ready   the step whose prompt is typed, or answered (type.js)
//   tour.said, tour.noteShown  what the last note was for, so each shows once
//   tour.seen                the welcome dialog has shown once
//   newwork.draft, newwork.start  what New work types by itself, and its Start (mods/new-work)
// Others write tour.top and tour.noted (lib/tour.js), tour.row (mods/tasks), and
// newwork.open, newwork.say and newwork.resume (mods/new-work).
import { shared, setShared, notify } from "herdr";

// Presses on the tour's own windows (lib/tour.js, tourNudge). A pressed window comes to the
// front, so the card and the sparkle open again on top of it.
export const nudges = () => shared("tour.top") ?? 0;
// Clicks that the tour blocked (lib/tour.js, tourNote): each shows the note.
export const noted = () => shared("tour.noted") ?? 0;

// Ends the tour's state: every veil lifts, its windows close themselves, and New work is
// its normal self again (clearing `newwork.open` closes the window the draft opened).
export function clear() {
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
  for (const key of ["draft", "open", "start", "resume"]) setShared(`newwork.${key}`, null);
}

// Where the tour went, for when you want it again.
export const remind = () =>
  notify({
    title: "The tour is in ⌘⇧P",
    body: "Search for “tour” to take it again, or click here.",
    action: { name: "mod.open", args: { name: "tour" } },
  });
