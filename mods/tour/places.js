// Where things are in the window. Herdr gives no element positions, so this reads the
// layout's sizes and lasso's own heights. All in layout px; `real` turns them into the
// window px that an overlay's `at` takes.
import { layout, settings, shared } from "herdr";
import { find, PAD, CONTROL, SECTION, SPARK } from "./lib/shared.js";
import { CARD_WIDTH, CARD_HEIGHT } from "./card.js";

const MARGIN = 16;
// The Agents list starts below its border and its "Agents" line (mods/tasks/main.js).
const LIST_TOP = 42;
// One row of that list (mods/tasks/lasso.js).
const ROW = 32;
// The Context panel's sample sections (mods/context/demo.js), from the panel's top.
const CONTEXT_STOPS = [73, 126, 287, 594];
// From a pane's top to the scripted child's "Allow npm test?" line (lasso-tour-agent).
// shortcut: assumes the default terminal font and padding, read them from settings() if the
// star lands off the line.
const PROMPT_LINE = 122;
// The New work dialog's size (mods/new-work/mod.json). Herdr centers it.
const DIALOG = { width: 560, height: 400 };

const zoom = () => settings().zoom ?? 1;
export const real = ({ x, y }) => ({ x: Math.round(x * zoom()), y: Math.round(y * zoom()) });

function frame() {
  const root = layout(),
    size = globalThis.window.viewport_size(),
    node = (id) => find(root, id),
    px = (id) => (node(id)?.hidden ? 0 : (node(id)?.size?.px ?? 0)),
    weight = (id) => node(id)?.size?.weight ?? 1,
    width = size.width / zoom(),
    height = size.height / zoom(),
    top = px("brand") + px("work-nav"),
    lists = height - top - px("sidebar-footer");
  return {
    width,
    height,
    sidebar: px("sidebar"),
    panel: px("panel"),
    tabs: px("tabs"),
    status: px("status"),
    agents: top + (lists * weight("spaces")) / (weight("spaces") + weight("agents")),
  };
}

const dialog = (at) => ({
  x: (at.width - DIALOG.width) / 2,
  y: (at.height - DIALOG.height) / 2,
});

// The coach card's top left: beside the Agents list, beside the Context panel, beside where
// the New work dialog opens (Herdr draws a dialog over every window), or the middle.
function card(place, at) {
  if (place === "panel") return { x: at.width - at.panel - CARD_WIDTH - 3 * MARGIN, y: 6 * MARGIN };
  if (place === "agents") return { x: at.sidebar + MARGIN, y: at.agents + MARGIN };
  if (place === "dialog")
    return { x: Math.max(MARGIN, dialog(at).x - CARD_WIDTH - MARGIN), y: dialog(at).y };
  return { x: (at.width - CARD_WIDTH) / 2, y: (at.height - CARD_HEIGHT) / 2 };
}

// The terminals' area: its top left, and its size as it is now.
export function main() {
  const at = frame();
  return {
    x: at.sidebar,
    y: at.tabs,
    width: at.width - at.sidebar - at.panel,
    height: at.height - at.tabs - at.status,
  };
}

// Where the note below the card opens.
export function under(place) {
  const { x, y } = card(place, frame());
  return real({ x, y: y + CARD_HEIGHT + 8 });
}

// Where a new card opens.
export const spot = (place) => real(card(place, frame()));

// Where the sparkle floats for a target (steps.js): beside an agent's sidebar row, a Context
// section, the line a blocked child waits on, the New work dialog's Start button, or else
// beside the card's last line.
function locate(target, place) {
  const at = frame(),
    [kind, value] = (target ?? "").split(":"),
    row = shared("tour.row");
  // A row the sidebar has not placed yet: the sparkle waits where it is.
  if (kind === "row")
    return row?.address === value
      ? { x: at.sidebar - SPARK - 2, y: at.agents + LIST_TOP + row.y + (ROW - SPARK) / 2 }
      : null;
  if (kind === "context")
    return {
      x: at.width - at.panel - SPARK + 4,
      y: at.tabs + CONTEXT_STOPS[value % CONTEXT_STOPS.length],
    };
  // herdr-child puts the second child bottom right: the lower half of the right column.
  if (kind === "enter") {
    const right = at.width - at.panel,
      bottom = at.height - at.status;
    return {
      x: (at.sidebar + right) / 2 - 6,
      y: (at.tabs + bottom) / 2 + PROMPT_LINE,
    };
  }
  // Outside the New work dialog's edge, level with its Start button: a window cannot draw
  // over a dialog.
  if (kind === "start")
    return {
      x: dialog(at).x + DIALOG.width + 6,
      y: dialog(at).y + DIALOG.height - SECTION - (CONTROL + SPARK) / 2,
    };
  const beside = card(place, at);
  return {
    // Beside the dialog, the card's right side is under it: the sparkle takes the left.
    x: place === "dialog" ? beside.x - SPARK - 6 : beside.x + CARD_WIDTH + 6,
    y: beside.y + CARD_HEIGHT - PAD - (CONTROL + SPARK) / 2,
  };
}

export function point(target, place) {
  const found = locate(target, place);
  return found && { x: Math.round(found.x), y: Math.round(found.y) };
}
