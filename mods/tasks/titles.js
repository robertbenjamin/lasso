import { TICKET, isFeatureBranch, liveTitle, isNamedTab, words } from "./shared.js";

// "owner/abc-4512-contract-type" -> "contract type" ("" when the branch is only a ticket ID)
const prettyBranch = (branch) =>
  branch
    .replace(/^[\w.-]+\//, "")
    .replace(TICKET, "")
    .replace(/[-_]+/g, " ")
    .trim();

function fallback(lead, info) {
  const live = liveTitle(lead);
  if (live) return live;
  const branch = isFeatureBranch(info?.branch) ? prettyBranch(info.branch) : "";
  if (branch) return branch;
  if (lead?.program?.agent) return "New session";
  return lead?.program?.shell || !lead?.program?.name ? "shell" : lead.program.name;
}

// A PR is a chip, never a title.
export function title(tab, lead, info) {
  if (isNamedTab(tab, lead)) return tab.name;
  if (info?.summary && lead?.program?.agent) return info.summary;
  return fallback(lead, info);
}

export function shortTitle(tab, lead, info) {
  if (isNamedTab(tab, lead)) return tab.name;
  if (lead?.program?.agent && (info?.summaryShort || info?.summary))
    return info.summaryShort ?? words(info.summary, 3);
  return fallback(lead, info);
}
