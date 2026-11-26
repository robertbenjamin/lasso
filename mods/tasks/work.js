// Shared state this file writes (mods/lasso-data writes the rest):
//   task.kind  { [tabId]: "ship" | "review" | "loop" | "side" }  kinds you set (they win over auto)

import { panes, spaces, terminals, shared, setShared, openOverlay } from "herdr";
import {
  words,
  liveTitle,
  conf,
  repoAlias,
  TICKET,
  WORKTREE,
  isFeatureBranch,
  worktreeRepo,
  prForBranch,
} from "./lib/shared.js";

export const KINDS = [
  { id: "loop", label: "Recurring", color: "ansi3" },
  { id: "ship", label: "Ship", color: "ansi6" },
  { id: "review", label: "Review", color: "ansi4" },
  { id: "side", label: "Side", color: "ansi5" },
];
const [LOOP, SHIP, REVIEW, SIDE] = KINDS;
// Titles start with a verb: "Review data#7420", not "Address review comments".
const REVIEWING = /^review\b/i;
export const AUTO = { id: "auto", label: "Auto", color: "dim" };

const MINUTE = 60000,
  DAY = 24 * 60 * MINUTE;
// A run after this much quiet starts a new session. Two sessions in a day on the default
// branch make a tab recurring.
const SESSION_GAP = 45 * MINUTE;

// Known limit: closed tabs' kinds and runs stay in shared.json. Prune them if they get big.
export function setKind(tab, kind) {
  if (!tab) return;
  const all = { ...shared("task.kind") };
  if (KINDS.some((k) => k.id === kind)) all[tab] = kind;
  else delete all[tab];
  setShared("task.kind", all);
}

export const kindOf = (tab, info) => info.get(tab) ?? { kind: SIDE, manual: false };

export function kindItems(tab, tabSpace, pin) {
  const { kind, manual } = kindOf(tab, context().info);
  const auto = { ...AUTO, label: manual ? "Auto" : `Auto (${kind.label.toLowerCase()} now)` };
  const items = [...KINDS, auto].map((k) => ({ ...k, dot: k.color }));
  if (tabSpace)
    items.push(
      {
        id: "rename",
        label: "Rename",
        icon: "square-pen",
        sep: true,
        cmd: "tab.rename",
        args: { id: tab },
      },
      { id: "new", label: "New tab", icon: "plus", cmd: "tab.new", args: { space: tabSpace } },
      { id: "close", label: "Close", icon: "x", cmd: "tab.close", args: { id: tab } },
    );
  if (pin)
    items.push({
      id: "pin",
      label: pin.pinned ? "Unpin" : "Pin to the top",
      icon: pin.pinned ? "pin-off" : "pin",
      sep: true,
      cmd: "terminal.pin",
      args: { terminal: pin.terminal, pinned: !pin.pinned },
    });
  return items;
}

// A popup needs its height up front: 5px padding top and bottom, 31px rows, 9px separators
// (pickMenu in lasso.js). mods/tasks-tabs/lasso.js has this number for the tab menu.
export const menuHeight = (items) =>
  10 + 31 * items.length + 9 * items.filter((item) => item.sep).length;

export const openKindMenu = (tab, { tabSpace = null, pin = null } = {}) =>
  openOverlay({
    mod: "tasks",
    kind: "popup",
    width: 200,
    height: menuHeight(kindItems(tab, tabSpace, pin)),
    at: "pointer",
    props: { kindMenu: tab, tabSpace, pin },
  });

// Only PRs in your PR list count, so each has its status.
const madePrs = (address, prs) => {
  const urls = (shared("task.sessionPrs") ?? {})[address]?.urls ?? [];
  return urls.map((url) => prs.find((p) => p.url === url)).filter(Boolean);
};
// Prefers an open PR.
const newest = (prs) => [...prs].reverse().find((p) => !p.merged) ?? prs.at(-1) ?? null;

const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);

// Pass panes() when you have it: each read copies the whole list.
export function context(allPanes = panes()) {
  // A child agent has its own task, so its branch and PR never become the tab's.
  const kids = new Set(
    terminals()
      .filter((k) => k.parent)
      .map((k) => k.address),
  );
  const tabBranchPane = new Map(),
    kidBranchPanes = new Map(),
    tabAgents = new Map(),
    kidAgents = new Map();
  for (const pane of allPanes) {
    if (!pane.terminal) continue;
    const isKid = kids.has(pane.terminal),
      feature = isFeatureBranch(pane.branch);
    push(isKid ? kidAgents : tabAgents, pane.tab, pane.terminal);
    if (!pane.branch) continue;
    if (isKid) {
      if (feature) push(kidBranchPanes, pane.tab, pane);
      continue;
    }
    // A feature branch in any pane of the tab wins over the default branch.
    const current = tabBranchPane.get(pane.tab);
    if (!current || (feature && !isFeatureBranch(current.branch)))
      tabBranchPane.set(pane.tab, pane);
  }
  const { list: prs = [], reviews = [] } = shared("task.prs") ?? {};
  const prOfPane = (pane) => prForBranch(prs, pane?.branch, worktreeRepo(pane?.cwd));
  const manual = shared("task.kind") ?? {};
  const runs = shared("task.runs") ?? {};
  const titles = shared("task.titles") ?? {};
  const now = Date.now();
  const info = new Map();
  for (const tab of spaces().flatMap((s) => s.tabs)) {
    const branchPane = tabBranchPane.get(tab.id);
    const branch = branchPane?.branch ?? null;
    const feature = isFeatureBranch(branch);
    const made = (tabAgents.get(tab.id) ?? []).flatMap((address) => madePrs(address, prs));
    const pr = prOfPane(branchPane) ?? newest(made);
    const kidPrs = [
      ...new Set([
        ...(kidBranchPanes.get(tab.id) ?? []).map(prOfPane),
        ...(kidAgents.get(tab.id) ?? []).flatMap((address) => madePrs(address, prs)),
      ]),
    ].filter((p) => p && p !== pr);

    const starts = runs[tab.id] ?? [];
    const sessionsToday = starts
      .filter((at, i) => i === 0 || at - starts[i - 1] >= SESSION_GAP)
      .filter((at) => now - at < DAY);
    const title = titles[tab.id];
    const hasTicket =
      (feature && TICKET.test(branch)) ||
      (tab.named && TICKET.test(tab.name)) ||
      Boolean(title?.ticket);
    // On the branch of a PR you are asked to review or reviewed (its ticket is not yours).
    const reviewing =
      Boolean(prForBranch(reviews, branch, worktreeRepo(branchPane?.cwd))) ||
      REVIEWING.test(title?.text ?? "") ||
      (tab.named && REVIEWING.test(tab.name));
    const auto = reviewing
      ? REVIEW
      : pr || hasTicket
        ? SHIP
        : !feature && sessionsToday.length >= 2
          ? LOOP
          : SIDE;
    const set = KINDS.find((k) => k.id === manual[tab.id]);

    info.set(tab.id, {
      branch,
      pr,
      kidPrs,
      lastRun: starts.at(-1) ?? null,
      kind: set ?? auto,
      manual: Boolean(set),
      summary: title?.text ?? null,
      summaryShort: title?.short ? words(title.short, 5) : null,
    });
  }
  return { info, prs };
}

// A PR title without its type, ticket ID or ticketWord: "feat(ats)!: ABC-12 Remove X" -> "Remove X".
export function bare(prTitle) {
  const rest = prTitle
    .replace(/^\w+(\([^)]*\))?!?:\s*/, "")
    .replace(/^\[?[a-z]{2,6}-\d+\b\]?:?\s*/i, "");
  const word = conf().ticketWord;
  return word && rest.startsWith(`${word} `) ? rest.slice(word.length + 1) : rest;
}

export const repoOf = (spaceName, cwd) => worktreeRepo(cwd) ?? spaceName;
// An unnamed worktree space is named after its folder (the branch): show its repo instead.
export const spaceLabel = (spaceName, cwd) => {
  const [, repo, folder] = cwd?.match(WORKTREE) ?? [];
  return repoAlias(folder === spaceName ? repo : spaceName);
};

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function duration(ms) {
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

// An agent's own status, not its tab's. A parked child has no pane, and "done" turns idle
// only in a pane, so a parked "done" counts as idle.
export function statusOf(pane, terminal) {
  if (pane?.status) return pane.status;
  const status = terminal?.status ?? "idle";
  return status === "error" ? "blocked" : status === "done" ? "idle" : status;
}

// Never the PR's title: the PR shows as a chip.
export function childLabel(address, pane, prs) {
  const branchPr = prForBranch(prs, pane?.branch, worktreeRepo(pane?.cwd));
  const title = (shared("task.titles") ?? {})[address]?.short;
  return { pr: branchPr ?? newest(madePrs(address, prs)), text: title || liveTitle(pane) };
}

// Looking at a done agent makes it idle. It stays under Done until you leave it, so it
// doesn't drop away under you.
export function holdDone(view, list) {
  const focused = list.find((a) => a.focused);
  const same = focused && focused.address === view.held?.address;
  if (!same || focused.status !== "idle")
    view.held = focused ? { address: focused.address, rank: RANK[focused.status] ?? 0 } : null;
}

export function heldRank(view, agent) {
  const sawDone =
    agent.address === view.held?.address && view.held.rank === RANK.done && agent.status === "idle";
  return sawDone ? RANK.done : (RANK[agent.status] ?? 0);
}
