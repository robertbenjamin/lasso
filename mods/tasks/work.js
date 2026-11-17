// The data behind the agents list (lasso.js) and the Work board (board.js): each tab's kind,
// your GitHub PRs and the run history. Titles are in titles.js.
//
// shared state:
//   task.kind         { [tabId]: "ship" | "loop" | "side" }  kinds you set (they win over auto)
//   task.prs          { at, list, error }                     your open and merged PRs, every 15 s
//   task.runs         { [tabId]: [workingSince, ...] }        when each tab's agents started working
//   task.sessionPrs   { [address]: { file, size, urls } }     the PRs each agent's session made
//   task.transcripts  { [address]: path }                     each live agent's Claude transcript

import { panes, spaces, terminals, shared, setShared, exec, readTextFile, appHome, openOverlay } from "herdr";
import { DEFAULT_BRANCHES, TICKET, words, findTranscript, liveTitle } from "./titles.js";
import { myTurn } from "./shared.js";

export const KINDS = [
  { id: "loop", label: "Recurring", color: "ansi3" },
  { id: "ship", label: "Ship", color: "ansi6" },
  { id: "side", label: "Side", color: "ansi5" },
];
const [LOOP, SHIP, SIDE] = KINDS;
export const AUTO = { id: "auto", label: "Auto", color: "dim" };

const MINUTE = 60000, DAY = 24 * 60 * MINUTE;
// A run after this much quiet starts a new session. Two sessions in a day on the default
// branch make a tab recurring.
const SESSION_GAP = 45 * MINUTE;

// ponytail: kinds and runs of closed tabs stay in shared.json; prune if they ever get big.
export function setKind(tab, kind) {
  if (!tab) return;
  const all = { ...(shared("task.kind") ?? {}) };
  if (KINDS.some((k) => k.id === kind)) all[tab] = kind;
  else delete all[tab];
  setShared("task.kind", all);
}

// `info`: context().info.
export const kindOf = (tab, info) => info.get(tab) ?? { kind: SIDE, manual: false };

// The kind menu's entries: the kinds and Auto, plus the tab items (from a tab: `tabSpace`) or
// pin/unpin (from an agent row: `pin`).
export function kindItems(tab, tabSpace, pin) {
  const { kind, manual } = kindOf(tab, context().info);
  const auto = { ...AUTO, label: manual ? "Auto" : `Auto (${kind.label.toLowerCase()} now)` };
  const items = [...KINDS, auto].map((k) => ({ ...k, dot: k.color }));
  if (tabSpace) items.push(
    { id: "rename", label: "Rename", icon: "square-pen", sep: true, cmd: "tab.rename", args: { id: tab } },
    { id: "new", label: "New tab", icon: "plus", cmd: "tab.new", args: { space: tabSpace } },
    { id: "close", label: "Close", icon: "x", cmd: "tab.close", args: { id: tab } },
  );
  if (pin) items.push({
    id: "pin", label: pin.pinned ? "Unpin" : "Pin to the top", icon: pin.pinned ? "pin-off" : "pin", sep: true,
    cmd: "terminal.pin", args: { terminal: pin.terminal, pinned: !pin.pinned },
  });
  return items;
}

// A popup needs its height up front: 5px padding top and bottom, 31px rows, 9px separators
// (pickMenu in lasso.js). mods/tasks-tabs/lasso.js has this number for the tab menu.
export const menuHeight = (items) => 10 + 31 * items.length + 9 * items.filter((item) => item.sep).length;

export const openKindMenu = (tab, { tabSpace = null, pin = null } = {}) =>
  openOverlay({ mod: "tasks", kind: "popup", width: 200, height: menuHeight(kindItems(tab, tabSpace, pin)), at: "pointer", props: { kindMenu: tab, tabSpace, pin } });

// PRs that an agent's session made (task.sessionPrs), oldest first. Only PRs in your PR list
// count, so each has its status.
const madePrs = (address, prs) => {
  const urls = (shared("task.sessionPrs") ?? {})[address]?.urls ?? [];
  return urls.map((url) => prs.find((p) => p.url === url)).filter(Boolean);
};
// The newest open PR, else the newest one.
const newest = (prs) => [...prs].reverse().find((p) => !p.merged) ?? prs.at(-1) ?? null;

const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);

// { info, prs }. info: per tab { branch, pr, kidPrs, lastRun, kind, manual, summary,
// summaryShort }. Pass panes() when you already have it: each read copies the whole list.
export function context(allPanes = panes()) {
  // A child agent (hc run from another agent) has its own task: its branch and PR never become
  // the tab's. Its PRs go in kidPrs, for the board.
  const kids = new Set(terminals().filter((k) => k.parent).map((k) => k.address));
  const tabBranch = new Map(), kidBranches = new Map(), tabAgents = new Map(), kidAgents = new Map();
  for (const pane of allPanes) {
    if (!pane.terminal) continue;
    const isKid = kids.has(pane.terminal), feature = pane.branch && !DEFAULT_BRANCHES.has(pane.branch);
    push(isKid ? kidAgents : tabAgents, pane.tab, pane.terminal);
    if (!pane.branch) continue;
    if (isKid) { if (feature) push(kidBranches, pane.tab, pane.branch); continue; }
    // A feature branch in any pane of the tab wins over the default branch.
    const current = tabBranch.get(pane.tab);
    if (!current || (feature && DEFAULT_BRANCHES.has(current))) tabBranch.set(pane.tab, pane.branch);
  }
  const prs = shared("task.prs")?.list ?? [];
  // ponytail: matched by branch name only, not repo; two repos with the same branch name would collide.
  // Open PRs go in last, so they win over a merged PR on the same (reused) branch.
  const prOfBranch = new Map([...prs.filter((p) => p.merged), ...prs.filter((p) => !p.merged)].map((p) => [p.branch, p]));
  const manual = shared("task.kind") ?? {};
  const runs = shared("task.runs") ?? {};
  const titles = shared("task.titles") ?? {};
  const now = Date.now();
  const info = new Map();
  for (const tab of spaces().flatMap((s) => s.tabs)) {
    const branch = tabBranch.get(tab.id) ?? null;
    const feature = Boolean(branch) && !DEFAULT_BRANCHES.has(branch);
    // The PR of the tab's branch, else one that an agent in the tab made.
    const made = (tabAgents.get(tab.id) ?? []).flatMap((address) => madePrs(address, prs));
    const pr = (feature ? prOfBranch.get(branch) : null) ?? newest(made);
    const kidPrs = [...new Set([
      ...(kidBranches.get(tab.id) ?? []).map((b) => prOfBranch.get(b)),
      ...(kidAgents.get(tab.id) ?? []).flatMap((address) => madePrs(address, prs)),
    ])].filter((p) => p && p !== pr);

    const starts = runs[tab.id] ?? [];
    const sessionsToday = starts.filter((at, i) => i === 0 || at - starts[i - 1] >= SESSION_GAP).filter((at) => now - at < DAY);
    const hasTicket = (feature && TICKET.test(branch)) || (tab.named && TICKET.test(tab.name));
    const auto = pr || hasTicket ? SHIP : !feature && sessionsToday.length >= 2 ? LOOP : SIDE;
    const set = KINDS.find((k) => k.id === manual[tab.id]);

    const title = titles[tab.id];
    info.set(tab.id, {
      branch, pr, kidPrs,
      lastRun: starts.at(-1) ?? null,
      kind: set ?? auto, manual: Boolean(set),
      summary: title?.text ?? null,
      summaryShort: title?.short ? words(title.short, 5) : null,
    });
  }
  return { info, prs };
}

// Stamps each new working stretch in task.runs. Idempotent, so every copy may call it.
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

// A session can open a PR for a branch that no pane is on (a worktree it only cd's into). So
// the PR comes from the tool call that made it (`gh pr create`, or a "create_pull_request" MCP
// tool) and the PR URL in that call's result. A PR only mentioned in chat never counts.
// Step 1 ($1 transcript, $2 its size at the last scan): the size, then the tool-call lines.
const MADE_CALLS = `size=$(wc -c < "$1" | tr -d ' '); echo "$size"; [ "$size" = "$2" ] && exit 0
grep -F -e 'gh pr create' -e 'create_pull_request' "$1" | grep -F '"type":"tool_use"' || true`;
// Step 2 ($1 transcript, then tool-call ids): the last PR URL in each call's result.
const MADE_URLS = `f=$1; shift; for id in "$@"; do
  grep -F "\\"tool_use_id\\":\\"$id\\"" "$f" | grep -oE 'https://github\\.com/[^/" ]+/[^/" ]+/pull/[0-9]+' | tail -1
done`;
// { size, urls }, or null when the transcript is unchanged or unreadable.
async function scanSessionPrs(file, lastSize) {
  const r = await exec("sh", ["-c", MADE_CALLS, "sh", file, String(lastSize ?? "")]);
  const [size, ...lines] = r.stdout.split("\n");
  if (r.code !== 0 || size.trim() === String(lastSize)) return null;
  const callIds = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    for (const part of Array.isArray(entry.message?.content) ? entry.message.content : []) {
      if (part.type !== "tool_use") continue;
      const madePr = (part.name === "Bash" && /\bgh pr create\b/.test(part.input?.command ?? "")) || /create_pull_request/i.test(part.name ?? "");
      if (madePr) callIds.push(part.id);
    }
  }
  const found = callIds.length ? await exec("sh", ["-c", MADE_URLS, "sh", file, ...callIds]) : { stdout: "" };
  return { size: Number(size.trim()), urls: [...new Set(found.stdout.split("\n").filter(Boolean))] };
}

// Each minute, for every live agent: its transcript path (task.transcripts, also for the
// titles and mods/context) and the PRs its session made (task.sessionPrs).
export async function refreshSessionPrs() {
  if (!myTurn("task.sessionPrsAt", 50000)) return;
  const old = shared("task.sessionPrs") ?? {};
  const next = {}, paths = {};
  for (const agent of terminals().filter((t) => t.state === "live" && t.program?.agent)) {
    const prev = old[agent.address];
    try {
      const file = await findTranscript(agent.address);
      if (!file) continue;
      paths[agent.address] = file;
      const scan = await scanSessionPrs(file, prev?.file === file ? prev.size : null);
      const keep = scan ? { file, ...scan } : prev;
      if (keep) next[agent.address] = keep;
    } catch { if (prev) next[agent.address] = prev; }
  }
  setShared("task.sessionPrs", next);
  setShared("task.transcripts", paths);
}

// Every 5 minutes: bin/herdr-worktree-gc removes unused worktrees (log: ~/.herdr/worktree-gc.log).
export async function cleanWorktrees() {
  if (!myTurn("task.gcAt", 290000)) return;
  await exec("sh", ["-c", '"$1/bin/herdr-worktree-gc" >/dev/null 2>&1', "sh", appHome()]).catch(() => null);
}

const PR_QUERY = `query { viewer { pullRequests(states: [OPEN, MERGED], first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
  number title url headRefName isDraft reviewDecision updatedAt state repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

// Your PRs into task.prs. Every copy calls this on a timer: it skips when the last fetch
// started less than `minAge` ms ago, so one copy fetches every 15 s. minAge 0: fetch now.
export async function refreshPrs(minAge = 14000) {
  const last = shared("task.prs") ?? {};
  if (Date.now() - (last.at ?? 0) < minAge) return;
  setShared("task.prs", { ...last, at: Date.now() });
  try {
    const r = await exec("gh", ["api", "graphql", "-f", `query=${PR_QUERY}`]);
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || `gh exited with ${r.code}`);
    const list = JSON.parse(r.stdout).data.viewer.pullRequests.nodes.map((n) => ({
      number: n.number,
      title: n.title,
      url: n.url,
      branch: n.headRefName,
      repo: n.repository.name,
      draft: n.isDraft,
      merged: n.state === "MERGED",
      review: n.reviewDecision,
      ci: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
      updated: Date.parse(n.updatedAt),
    }));
    setShared("task.prs", { at: Date.now(), list, error: null });
  } catch (e) {
    setShared("task.prs", { ...(shared("task.prs") ?? {}), error: String(e?.message ?? e) });
  }
}

// lasso.json (app folder), read again with each refresh. Bad JSON keeps the last good one.
//   repoAliases  { "my-long-service": "svc" }: short repo names for the rows
//   ticketWord   the word your PR titles use when there is no ticket ("TECH")
let conf = {};
export async function loadConf() {
  const text = await readTextFile(`${appHome()}/lasso.json`).catch(() => null);
  try { conf = text ? JSON.parse(text) : {}; } catch {}
}
export const repoAlias = (repo) => conf.repoAliases?.[repo] ?? repo;
export const isAlias = (label) => Object.values(conf.repoAliases ?? {}).includes(label);

// A PR title without its type, ticket ID or ticketWord: "feat(ats)!: ABC-12 Remove X" -> "Remove X".
export function bare(prTitle) {
  const rest = prTitle.replace(/^\w+(\([^)]*\))?!?:\s*/, "").replace(/^\[?[a-z]{2,6}-\d+\b\]?:?\s*/i, "");
  const word = conf.ticketWord;
  return word && rest.startsWith(`${word} `) ? rest.slice(word.length + 1) : rest;
}

// The repo a space works in: a worktree's (~/.herdr/worktrees/<repo>/<branch>), else the space's name.
const WORKTREE = /\/\.herdr\/worktrees\/([^/]+)\/([^/]+)/;
export const repoOf = (spaceName, cwd) => cwd?.match(WORKTREE)?.[1] ?? spaceName;
// An unnamed worktree space is named after its folder (the branch): show its repo instead.
export const spaceLabel = (spaceName, cwd) => {
  const [, repo, folder] = cwd?.match(WORKTREE) ?? [];
  return repoAlias(folder === spaceName ? repo : spaceName);
};

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function duration(ms) {
  const m = Math.floor(ms / MINUTE);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// One agent's own status: its pane's, else (a parked child has no pane) its terminal's. Never
// its tab's, which is the most urgent of all its agents. "done" turns idle once you look,
// which needs a pane: a parked "done" is idle.
export function statusOf(pane, terminal) {
  if (pane?.status) return pane.status;
  const status = terminal?.status ?? "idle";
  return status === "error" ? "blocked" : status === "done" ? "idle" : status;
}

// A child agent's own { pr, text }: the short title Haiku wrote for it, else the title the
// agent set. Never the PR's title: the PR is the chip. `pane` is undefined for a parked child.
export function childLabel(address, pane, prs) {
  const branchPr = pane?.branch && !DEFAULT_BRANCHES.has(pane.branch) ? prs.find((p) => p.branch === pane.branch) : null;
  const title = (shared("task.titles") ?? {})[address]?.short;
  return { pr: branchPr ?? newest(madePrs(address, prs)), text: title || liveTitle(pane) };
}

// Looking at a done agent makes it idle. It stays with Done until you leave it, so it doesn't
// drop away under you. `view` is the Agents view: holdDone(view, list) each render.
export function holdDone(view, list) {
  const focused = list.find((a) => a.focused);
  const same = focused && focused.address === view.held?.address;
  // Arriving, or any change but done turning idle, records the status.
  if (!same || focused.status !== "idle") view.held = focused ? { address: focused.address, rank: RANK[focused.status] ?? 0 } : null;
}

export function heldRank(view, a) {
  const sawDone = a.address === view.held?.address && view.held.rank === RANK.done && a.status === "idle";
  return sawDone ? RANK.done : RANK[a.status] ?? 0;
}
