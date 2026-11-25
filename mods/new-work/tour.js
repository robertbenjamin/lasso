// New work's part in the tour (mods/tour). A dialog dims all under it, the tour's card too, so
// a draft with `lit` gets the same view as a window, which does not dim: the tour dims the app.
import { openOverlay, shared, setShared } from "herdr";
import { NEW_WORK_SIZE } from "./lib/shared.js";

// A running tour holds its lit window open: the way out is the × on the tour's card.
export const held = () => Boolean(shared("tour.step"));
// Presses on the tour's windows (lib/tour.js, tourNudge): each brings one to the front.
const nudges = () => shared("tour.top") ?? 0;

export const openLit = () =>
  openOverlay({
    mod: "new-work",
    kind: "window",
    ...NEW_WORK_SIZE,
    props: { lit: true, nudges: nudges() },
  });

// A lit window that a press on the tour's dimmer has put behind it.
export const behind = (given) => Boolean(given?.lit) && given.nudges !== nudges();

// Opens the lit window again on top, with what is typed and what is still to type.
export function reopen(view) {
  setShared("newwork.resume", {
    text: view.box.value(),
    repo: view.repoInput.value().trim() || "auto",
    picked: view.pickedModel,
    keys: view.pending ?? [],
  });
  openLit();
}
