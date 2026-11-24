import { div } from "gpui-kit";
import { shared } from "herdr";
import { RADIUS } from "./layout.js";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// mods/tour says in shared "tour.focus" what its step is about: { glow: [section], act }.
// A mod adds `.children(tourRing(t, "its-section"))` to its root to glow then, and
// `.children(tourSpark(t, "its-target"))` beside the control `act` names.
const ACCENT_SOFT = "38"; // the accent at 22%, as hex alpha
const BREATH = { from: 0.35, to: 1, period: 2200 };
const DOT = 6,
  HALO = 16;

const ring = (t, width, color) =>
  div()
    .absolute()
    .inset_0()
    .rounded(RADIUS)
    .border(width)
    .border_color(color)
    .loop("opacity", BREATH);

export const tourRing = (t, section) =>
  shared("tour.focus")?.glow?.includes(section)
    ? [ring(t, 4, t.accent + ACCENT_SOFT), ring(t, 1, t.accent)]
    : [];

// A dot that drifts inside its halo: here is what to do next.
export const spark = (t) =>
  div()
    .size(HALO)
    .flex_none()
    .child(
      div()
        .absolute()
        .inset_0()
        .rounded(HALO / 2)
        .bg(t.accent + ACCENT_SOFT)
        .loop("opacity", { from: 0.2, to: 1, period: 1300 }),
    )
    .child(
      div()
        .absolute()
        .size(DOT)
        .rounded(DOT / 2)
        .bg(t.accent)
        .loop("left", { from: 2, to: HALO - DOT - 2, period: 1900 })
        .loop("top", { from: HALO - DOT - 3, to: 3, period: 1300 }),
    );

export const tourSpark = (t, target) => (shared("tour.focus")?.act === target ? [spark(t)] : []);
