// The tour's part in the agents list (mods/tour), called from a one-line hook in main.js.
import { shared, setShared } from "herdr";
import { AGENT_ROW } from "./lib/shared.js";

// Tells the tour where the agent row its sparkle points at is: px below the list's top.
// A group header, then AGENT_ROW for each row.
const HEADER_HEIGHT = 34;
export function tourRow(view, groups, kidsOf) {
  const [kind, address] = (shared("tour.step") ? (shared("tour.spark") ?? "") : "").split(":");
  if (kind !== "row") return;
  let y = -(view.listScroll?.offset().y ?? 0);
  const found = () => {
    const known = shared("tour.row");
    if (known?.address !== address || known.y !== y) setShared("tour.row", { address, y });
  };
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
