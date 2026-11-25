// The tour's part in the agents list (mods/tour), called from a one-line hook in main.js.
import { shared, setShared } from "herdr";
import { AGENT_ROW } from "./lib/shared.js";

// Stock heights in main.js that lasso does not own: a group header (`header`, `.h(34)`) and
// the "Agents" line above the list (`.h(41)`).
const HEADER_HEIGHT = 34;
const TITLE_HEIGHT = 41;

// Tells the tour where the agent row its sparkle points at is: px below where the list starts
// in a wide sidebar (places.js LIST_TOP). A group header, then AGENT_ROW for each row.
// `rail`: the collapsed sidebar's agents, drawn with no title, no headers and no sub-agents.
export function tourRow(view, groups, kidsOf, rail) {
  const [kind, address] = (shared("tour.step") ? (shared("tour.spark") ?? "") : "").split(":");
  if (kind !== "row") return;
  let y = -(view.listScroll?.offset().y ?? 0);
  const found = () => {
    const known = shared("tour.row");
    if (known?.address !== address || known.y !== y) setShared("tour.row", { address, y });
  };
  if (rail) {
    const index = rail.findIndex((agent) => agent.address === address);
    if (index < 0) return;
    y += AGENT_ROW * index - TITLE_HEIGHT;
    return found();
  }
  for (const group of groups) {
    y += HEADER_HEIGHT;
    if (view.folded.has(group.id)) continue;
    for (const agent of group.members) {
      const rows = [agent.address, ...(view.folded.has(agent.address) ? [] : kidsOf(agent))];
      const index = rows.indexOf(address);
      if (index >= 0) {
        y += AGENT_ROW * index;
        return found();
      }
      y += AGENT_ROW * rows.length;
    }
  }
}
