// Where things are in lasso's window. Herdr gives no element positions, so this reads the
// layout's sizes and lasso's own heights. All in layout px; `real` turns them into the real
// px (layout px times the zoom) that an overlay's `at` takes.
import { layout, settings, shared } from "herdr";
import { find, GAP, PAD, CONTROL, SECTION, AGENT_ROW, NEW_WORK_SIZE } from "./lib/shared.js";
import { SPARK } from "./sparkle.js";
import { CARD_WIDTH, CARD_HEIGHT } from "./card.js";

const MARGIN = 16;

// Measured on one screen. Check these first when a card or a sparkle lands off its mark.
// The Agents list starts below its border and its "Agents" line (mods/tasks/main.js).
const LIST_TOP = 42;
// The Context panel's sample sections (mods/context/demo.js), from the panel's top.
const CONTEXT_STOPS = [73, 126, 287, 594];
// From a pane's top to a scripted agent's first line, and a terminal line's height.
// shortcut: assumes the default terminal font and padding, read them from settings() if the
// star lands off the line.
const FIRST_LINE = 42,
  TERMINAL_LINE = 16,
  // A child's prompt, ten lines further down (lasso-tour-agent's child scene).
  KID_PROMPT = FIRST_LINE + 10 * TERMINAL_LINE;
// From the panes' top to the lead's second prompt, where the tour types.
const ASK_LINE = 194;

const zoom = () => settings().zoom ?? 1;
export const real = ({ x, y }) => ({ x: Math.round(x * zoom()), y: Math.round(y * zoom()) });
export const same = (a, b) => a?.x === b?.x && a?.y === b?.y;

function frame() {
  const root = layout(),
    size = globalThis.window.viewport_size(),
    node = (id) => find(root, id),
    px = (id) => (node(id)?.hidden ? 0 : (node(id)?.size?.px ?? 0)),
    weight = (id) => node(id)?.size?.weight ?? 1,
    width = size.width / zoom(),
    height = size.height / zoom(),
    top = px("brand") + px("work-nav"),
    lists = height - top - px("sidebar-footer"),
    padding = node("work-body")?.padding ?? 0;
  return {
    width,
    height,
    sidebar: px("sidebar"),
    panel: px("panel"),
    // The panel sits this far in from the window's edge (the layout's padding around the work).
    inset: px("panel") ? [padding].flat().at(-1) : 0,
    tabs: px("tabs"),
    status: px("status"),
    agents: top + (lists * weight("spaces")) / (weight("spaces") + weight("agents")),
  };
}

// Where Herdr centers the New work dialog.
const dialog = (at) => ({
  x: (at.width - NEW_WORK_SIZE.width) / 2,
  y: (at.height - NEW_WORK_SIZE.height) / 2,
});

// The coach card's top left: beside the Agents list, beside the Context panel, beside where
// the New work dialog opens (Herdr draws a dialog over every window), or the middle.
function card(place, at) {
  // shortcut: counts the scripted parent's lines (lasso-tour-agent) at their width in a
  // wide window. In a narrow one more lines wrap, and the gap to the typing grows.
  if (place?.startsWith("above:")) {
    const line = at.tabs + FIRST_LINE + Number(place.split(":")[1]) * TERMINAL_LINE;
    // Not the card's real height: that is known only after it opens, and would move it.
    return { x: at.sidebar + MARGIN, y: line - 2 * TERMINAL_LINE - CARD_HEIGHT };
  }
  if (place === "panel") return { x: at.width - at.panel - CARD_WIDTH - 3 * MARGIN, y: 6 * MARGIN };
  if (place === "agents") return { x: at.sidebar + MARGIN, y: at.agents + MARGIN };
  if (place === "dialog")
    return { x: Math.max(MARGIN, dialog(at).x - CARD_WIDTH - MARGIN), y: dialog(at).y };
  return { x: (at.width - CARD_WIDTH) / 2, y: (at.height - CARD_HEIGHT) / 2 };
}

// The terminals' area, or the whole window: its top left, and its size as it is now.
export function main(whole) {
  const at = frame();
  if (whole) return { x: 0, y: 0, width: at.width, height: at.height };
  return {
    x: at.sidebar,
    y: at.tabs,
    width: at.width - at.sidebar - at.panel - at.inset,
    height: at.height - at.tabs - at.status,
  };
}

// The card's height now: it hugs its text, and says in shared "tour.card" how tall it is,
// in the window's real px.
const tall = () => (shared("tour.card") ? shared("tour.card").height / zoom() : CARD_HEIGHT);

// Where the note below the card opens.
export function under(place) {
  const { x, y } = card(place, frame());
  return real({ x, y: y + tall() + GAP });
}

// Where a new card opens.
export const spot = (place) => real(card(place, frame()));

// Where the sparkle floats for a target (steps.js): beside an agent's sidebar row, a Context
// section, a line in a demo agent's terminal, the New work dialog's Start button, or else
// beside the card's last line.
function locate(target, place) {
  const at = frame(),
    [kind, value] = (target ?? "").split(":"),
    row = shared("tour.row");
  // A row the sidebar has not placed yet: the sparkle waits where it is.
  if (kind === "row")
    return row?.address === value
      ? { x: at.sidebar - SPARK - 2, y: at.agents + LIST_TOP + row.y + (AGENT_ROW - SPARK) / 2 }
      : null;
  if (kind === "context")
    return {
      x: at.width - at.panel - SPARK + 4,
      y: at.tabs + CONTEXT_STOPS[value % CONTEXT_STOPS.length],
    };
  // The lead's own prompt, while it is the only pane.
  if (kind === "ask") return { x: at.sidebar - SPARK / 2, y: at.tabs + ASK_LINE };
  // herdr-child puts the children in the right column: the first on top, the second below.
  // "kid" is a child's first line, "type" its prompt once its scene has run.
  if (kind === "kid" || kind === "type") {
    const right = at.width - at.panel,
      bottom = at.height - at.status,
      lower = Number(value) > 0;
    return {
      x: (at.sidebar + right) / 2 - 6,
      y: (lower ? (at.tabs + bottom) / 2 : at.tabs) + (kind === "type" ? KID_PROMPT : FIRST_LINE),
    };
  }
  // Outside the New work dialog's edge, level with its Start button: a window cannot draw
  // over a dialog.
  if (kind === "start")
    return {
      x: dialog(at).x + NEW_WORK_SIZE.width + 6,
      y: dialog(at).y + NEW_WORK_SIZE.height - SECTION - (CONTROL + SPARK) / 2,
    };
  const beside = card(place, at);
  return {
    // Beside the dialog, the card's right side is under it: the sparkle takes the left.
    x: place === "dialog" ? beside.x - SPARK - 6 : beside.x + CARD_WIDTH + 6,
    y: beside.y + tall() - PAD - (CONTROL + SPARK) / 2,
  };
}

// The last card's fan: its sparkles land this far from the first one, at these degrees.
const REACH = 40,
  FAN = [-60, -20, 20, 60];
const fanned = ({ x, y }, angle) => ({
  x: Math.round(x + REACH * Math.cos(angle)),
  y: Math.round(y + REACH * Math.sin(angle)),
});

// Every place a target points at. Most have one. "context" is each of the panel's sections
// "kids" both children's panes, "burst" a fan beside the card: there the sparkle splits.
export function points(target, place) {
  const each = (kind, count) =>
    Array.from({ length: count }, (_unused, index) => point(`${kind}:${index}`, place));
  if (target === "context") return each("context", CONTEXT_STOPS.length);
  if (target === "kids") return each("kid", 2);
  if (target === "burst") {
    const [center] = points(null, place);
    return [center, ...FAN.map((angle) => fanned(center, (angle * Math.PI) / 180))];
  }
  return [point(target, place)].filter(Boolean);
}

function point(target, place) {
  const found = locate(target, place);
  return found && { x: Math.round(found.x), y: Math.round(found.y) };
}
