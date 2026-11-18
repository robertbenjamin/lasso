// A tab's lead pane: its first agent, else its first focused terminal, else its first terminal.
export function leadPanes(allPanes) {
  const leads = new Map();
  for (const pane of allPanes) {
    if (!pane.terminal) continue;
    const lead = leads.get(pane.tab);
    const better =
      lead && !lead.program?.agent && (pane.program?.agent || (!lead.focused && pane.focused));
    if (!lead || better) leads.set(pane.tab, pane);
  }
  return leads;
}

// Not a shell's folder, a path or the program's own name. `pane` may be a terminal: a parked
// child has no pane.
export function liveTitle(pane) {
  if (!pane || pane.program?.shell) return null;
  const raw = pane.title ?? "";
  const title = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const isPath =
    /^[~/]|^[A-Za-z]:\\/.test(raw.replace(/^[^\p{L}\p{N}~/]+/u, "")) || /^\S*\/\S*$/.test(title);
  const isProgram = title === pane.program?.name || title.toLowerCase() === pane.program?.key;
  return title && !isProgram && !isPath && !title.includes("@") ? title : null;
}

// Herdr names agent tabs after the program ("Claude Code"): that is no name.
export const isNamedTab = (tab, lead) => Boolean(tab?.named) && tab.name !== lead?.program?.name;

// Small words that can't end a title: "Ruleset split and" -> "Ruleset split".
export const LOOSE_END = /(\s+(and|or|but|for|the|of|to|with|in|on|at|by|from|a|an|vs))+$/i;

// A first clause of 2 to n+1 words wins: "Herdr UI, auto-run and sandbox" -> "Herdr UI".
export function words(text, n) {
  const clause = text.split(/[,:;]\s/)[0];
  const clauseFits = /\s/.test(clause) && clause.split(/\s+/).length <= n + 1;
  const pick = clauseFits ? clause : text.split(/\s+/).slice(0, n).join(" ");
  return pick
    .replace(/\s*\([^)]*$/, "")
    .replace(/[\s,:;.-]+$/, "")
    .replace(LOOSE_END, "");
}
