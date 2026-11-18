// Shared state this file writes:
//   task.kind         { [tabId]: "ship" | "loop" | "side" }  kinds you set (they win over auto)
//   task.prs          { at, list, error }                     your open and merged PRs, every 15 s
//   task.runs         { [tabId]: [workingSince, ...] }        when each tab's agents started working
//   task.sessionPrs   { [address]: { file, size, urls } }     the PRs each agent's session made
//   task.transcripts  { [address]: path }                     each live agent's Claude transcript

import { panes, spaces, terminals, shared, setShared, exec, openOverlay } from "herdr";
import { words, findTranscript, liveTitle } from "./titles.js";
import {
  bin,
  myTurn,
  conf,
  TICKET,
  WORKTREE,
  isFeatureBranch,
  worktreeRepo,
  prForBranch,
} from "./shared.js";

export const KINDS = [
  { id: "loop", label: "Recurring", color: "ansi3" },
  { id: "ship", label: "Ship", color: "ansi6" },
  { id: "side", label: "Side", color: "ansi5" },
];
const [LOOP, SHIP, SIDE] = KINDS;
export const AUTO = { id: "auto", label: "Auto", color: "dim" };

const MINUTE = 60000,
  DAY = 24 * 60 * MINUTE;
// A run after this much quiet starts a new session. Two sessions in a day on the default
// branch make a tab recurring.
const SESSION_GAP = 45 * MINUTE;

// ponytail: kinds and runs of closed tabs stay in shared.json; prune if they ever get big.
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
  const prs = shared("task.prs")?.list ?? [];
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
    const hasTicket = (feature && TICKET.test(branch)) || (tab.named && TICKET.test(tab.name));
    const auto = pr || hasTicket ? SHIP : !feature && sessionsToday.length >= 2 ? LOOP : SIDE;
    const set = KINDS.find((k) => k.id === manual[tab.id]);

    const title = titles[tab.id];
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

// Idempotent, so every copy may call it.
export function trackRuns() {
  const runs = shared("task.runs") ?? {};
  let next = null;
  for (const tab of spaces().flatMap((s) => s.tabs)) {
    const since = tab.working_since;
    if (!since || (runs[tab.id] ?? []).includes(since)) continue;
    next ??= { ...runs };
    next[tab.id] = [...(runs[tab.id] ?? []), since].slice(-30);
  }
  if (next) setShared("task.runs", next);
}

// A session can open a PR for a branch no pane is on (a worktree it only cd's into), so the
// PRs come from the tool calls that made them. Null when the transcript is unchanged.
async function scanSessionPrs(file, lastSize) {
  const result = await exec(bin("lasso-session-prs"), [file, String(lastSize ?? "")]);
  const [size, ...urls] = result.stdout.trim().split("\n");
  if (result.code !== 0 || size === String(lastSize)) return null;
  return { size: Number(size), urls: urls.filter(Boolean) };
}

export async function refreshSessionPrs() {
  if (!myTurn("task.sessionPrsAt", 50000)) return;
  const old = shared("task.sessionPrs") ?? {};
  const next = {},
    paths = {};
  for (const agent of terminals().filter((t) => t.state === "live" && t.program?.agent)) {
    const prev = old[agent.address];
    try {
      const file = await findTranscript(agent.address);
      if (!file) continue;
      paths[agent.address] = file;
      const scan = await scanSessionPrs(file, prev?.file === file ? prev.size : null);
      const keep = scan ? { file, ...scan } : prev;
      if (keep) next[agent.address] = keep;
    } catch {
      if (prev) next[agent.address] = prev;
    }
  }
  setShared("task.sessionPrs", next);
  setShared("task.transcripts", paths);
}

export async function cleanWorktrees() {
  if (!myTurn("task.gcAt", 290000)) return;
  await exec(bin("herdr-worktree-gc")).catch(() => null);
}

const PR_QUERY = `query { viewer { pullRequests(states: [OPEN, MERGED], first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
  number title url headRefName isDraft reviewDecision updatedAt state repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

// Every copy calls this on a timer; only one fetches per `minAge` ms. 0 fetches now.
export async function refreshPrs(minAge = 14000) {
  const last = shared("task.prs") ?? {};
  if (Date.now() - (last.at ?? 0) < minAge) return;
  setShared("task.prs", { ...last, at: Date.now() });
  try {
    const result = await exec("gh", ["api", "graphql", "-f", `query=${PR_QUERY}`]);
    if (result.code !== 0)
      throw new Error(result.stderr.trim().split("\n")[0] || `gh exited with ${result.code}`);
    const list = JSON.parse(result.stdout).data.viewer.pullRequests.nodes.map((node) => ({
      number: node.number,
      title: node.title,
      url: node.url,
      branch: node.headRefName,
      repo: node.repository.name,
      draft: node.isDraft,
      merged: node.state === "MERGED",
      review: node.reviewDecision,
      ci: node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      updated: Date.parse(node.updatedAt),
    }));
    setShared("task.prs", { at: Date.now(), list, error: null });
  } catch (e) {
    setShared("task.prs", { ...shared("task.prs"), error: String(e?.message ?? e) });
  }
}

export const repoAlias = (repo) => conf().repoAliases?.[repo] ?? repo;
export const isAlias = (label) => Object.values(conf().repoAliases ?? {}).includes(label);

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
