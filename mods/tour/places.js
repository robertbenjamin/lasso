// Where things are in the window. Herdr gives no element positions, so this reads the
// layout's sizes and lasso's own heights. All in layout px; `real` turns them into the
// window px that an overlay's `at` takes.
import { layout, settings, shared } from "herdr";
import { find } from "./lib/shared.js";
import { CARD_WIDTH } from "./card.js";

const MARGIN = 16;
// The Agents list starts below its border and its "Agents" line (mods/tasks/main.js).
const LIST_TOP = 42;
// The Context panel's sample sections (mods/context/demo.js), from the panel's top.
const CONTEXT_STOPS = [75, 128, 289, 596];
// From a pane's top to the scripted child's "Allow npm test?" line (lasso-tour-agent).
// shortcut: assumes the default terminal font and padding, read them from settings() if the
// star lands off the line.
const PROMPT_LINE = 140;
// The card's height is its content's: about this much.
const CARD_HEIGHT = 190;

const zoom = () => settings().zoom ?? 1;
export const real = ({ x, y }) => ({ x: x * zoom(), y: y * zoom() });

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

// The coach card's top left: beside the Agents list, beside the Context panel, or the middle.
function card(place, at) {
  if (place === "panel") return { x: at.width - at.panel - CARD_WIDTH - 3 * MARGIN, y: 6 * MARGIN };
  if (place === "agents") return { x: at.sidebar + MARGIN, y: at.agents + MARGIN };
  return { x: (at.width - CARD_WIDTH) / 2, y: (at.height - CARD_HEIGHT) / 2 };
}

// Where a new card opens: undefined lets Herdr center it.
export const spot = (place) => (place ? real(card(place, frame())) : undefined);

// Where the sparkle floats for a target (steps.js): beside an agent's sidebar row, a Context
// section, the line a blocked child waits on, or else beside the card's button.
function locate(target, place) {
  const at = frame(),
    [kind, value] = (target ?? "").split(":"),
    row = shared("tour.row");
  if (kind === "row" && row?.address === value)
    return { x: at.sidebar - 30, y: at.agents + LIST_TOP + row.y + 4 };
  if (kind === "context")
    return {
      x: at.width - at.panel - 18,
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
  const beside = card(place, at);
  return { x: beside.x + CARD_WIDTH + 10, y: beside.y + CARD_HEIGHT - 52 };
}

export function point(target, place) {
  const { x, y } = locate(target, place);
  return { x: Math.round(x), y: Math.round(y) };
}
