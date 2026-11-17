// Shared by the sidebar list (main.js) and the Work board (board.js):
// kinds, the automatic kind of each tab, your open GitHub PRs, and run history.
// What a task is called is in titles.js.
//
// shared state:
//   task.kind  { [tabId]: "ship" | "loop" | "side" }   manual kinds (they win over auto)
//   task.prs   { at, list, error }                      your open and merged PRs, from `gh`, every 15 s
//   task.runs  { [tabId]: [workingSince, ...] }          when each tab's agents started working
//   task.transcripts { [address]: path }                each live agent's Claude transcript, every minute

import { panes, spaces, terminals, shared, setShared, exec, readTextFile, appHome, openOverlay } from "herdr";
import { DEFAULT_BRANCHES, TICKET, words, findTranscript, liveTitle } from "./titles.js";

export const KINDS = [
  { id: "loop", label: "Recurring", color: "ansi3" },
  { id: "ship", label: "Ship", color: "ansi6" },
  { id: "side", label: "Side", color: "ansi5" },
];
const [LOOP, SHIP, SIDE] = KINDS;
export const AUTO = { id: "auto", label: "Auto", color: "dim" };

// A new run after this much quiet is a new session; two sessions in a day on the default branch = recurring.
const GAP = 45 * 60000;
const DAY = 24 * 3600000;

// ponytail: tags and runs of closed tabs stay in shared.json; prune if they ever get big.
export function setKind(tab, kind) {
  if (!tab) return;
  const all = { ...(shared("task.kind") ?? {}) };
  if (KINDS.some((k) => k.id === kind)) all[tab] = kind;
  else delete all[tab];
  setShared("task.kind", all);
}

export const kindOf = (tab, info = context().info) => info.get(tab) ?? { kind: KINDS[2], manual: false };

// The kind menu's entries: the kinds and Auto; from a tab (`tabSpace`) also the shipped tab menu's
// items; from an agent row (`pin`) pin or unpin it. lasso.js draws them (kindMenu).
export function kindItems(tab, tabSpace, pin) {
  const { kind, manual } = kindOf(tab);
  const items = [...KINDS, { ...AUTO, label: manual ? "Auto" : `Auto (${kind.label.toLowerCase()} now)` }].map((k) => ({ ...k, dot: k.color }));
  if (tabSpace) items.push(
    { id: "rename", label: "Rename", icon: "square-pen", sep: true, cmd: "tab.rename", args: { id: tab } },
    { id: "new", label: "New tab", icon: "plus", cmd: "tab.new", args: { space: tabSpace } },
    { id: "close", label: "Close", icon: "x", cmd: "tab.close", args: { id: tab } },
  );
  if (pin) items.push({ id: "pin", label: pin.pinned ? "Unpin" : "Pin to the top", icon: pin.pinned ? "pin-off" : "pin", sep: true, cmd: "terminal.pin", args: { terminal: pin.terminal, pinned: !pin.pinned } });
  return items;
}

// A popup needs its height up front (OverlaySpec): sized from the entries as pickMenu draws them
// (5px padding top and bottom, 31px rows, 9px separators). tasks-tabs keeps the tab-menu number.
export const menuHeight = (items) => 10 + 31 * items.length + 9 * items.filter((s) => s.sep).length;

// Right-click on an agent row, a board row or a tab: the kind menu at the pointer.
export const openKindMenu = (tab, { tabSpace = null, pin = null } = {}) =>
  openOverlay({ mod: "tasks", kind: "popup", width: 200, height: menuHeight(kindItems(tab, tabSpace, pin)), at: "pointer", props: { kindMenu: tab, tabSpace, pin } });

// Per tab: branch, PR, last run, kind and whether the kind is manual. Read panes() once per render.
export function context(all = panes()) {
  const branches = new Map();
  // A child agent (hc run from another agent) has its own task: its branch and PR never
  // become the tab's. Its PR goes in kidPrs, for the board.
  const kids = new Set(terminals().filter((k) => k.parent).map((k) => k.address));
  const kidBranches = new Map();
  // The agents in each tab: a PR their session made counts when no pane's branch has one.
  const tabTerms = new Map(), kidTerms = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const m = kids.has(p.terminal) ? kidTerms : tabTerms;
    m.set(p.tab, [...(m.get(p.tab) ?? []), p.terminal]);
  }
  for (const p of all) {
    if (!p.terminal || !p.branch) continue;
    if (kids.has(p.terminal)) {
      if (!DEFAULT_BRANCHES.has(p.branch)) kidBranches.set(p.tab, [...(kidBranches.get(p.tab) ?? []), p.branch]);
      continue;
    }
    const cur = branches.get(p.tab);
    // A feature branch in any pane of the tab wins over master.
    if (!cur || (DEFAULT_BRANCHES.has(cur) && !DEFAULT_BRANCHES.has(p.branch))) branches.set(p.tab, p.branch);
  }
  const prs = shared("task.prs")?.list ?? [];
  // ponytail: matched by branch name only, not repo; two repos with the same branch name would collide.
  // Open PRs go in last, so they win over a merged PR on the same (reused) branch.
  const byBranch = new Map([...prs.filter((p) => p.merged), ...prs.filter((p) => !p.merged)].map((p) => [p.branch, p]));
  const manual = shared("task.kind") ?? {};
  const runs = shared("task.runs") ?? {};
  const titles = shared("task.titles") ?? {};
  const now = Date.now();
  const info = new Map();
  for (const s of spaces()) {
    for (const tab of s.tabs) {
      const branch = branches.get(tab.id) ?? null;
      const feature = Boolean(branch) && !DEFAULT_BRANCHES.has(branch);
      const made = (tabTerms.get(tab.id) ?? []).flatMap((a) => madePrs(a, prs));
      const pr = (feature ? byBranch.get(branch) : null) ?? newest(made);
      const starts = runs[tab.id] ?? [];
      const sessions = starts.filter((x, i) => i === 0 || x - starts[i - 1] >= GAP).filter((x) => now - x < DAY);
      const auto = pr || (feature && TICKET.test(branch)) || (tab.named && TICKET.test(tab.name)) ? SHIP
        : !feature && sessions.length >= 2 ? LOOP
        : SIDE;
      const set = KINDS.find((k) => k.id === manual[tab.id]);
      const kidPrs = [...new Set([
        ...(kidBranches.get(tab.id) ?? []).map((b) => byBranch.get(b)),
        ...(kidTerms.get(tab.id) ?? []).flatMap((a) => madePrs(a, prs)),
      ])].filter((p) => p && p !== pr);
      info.set(tab.id, { branch, pr, kidPrs, lastRun: starts.at(-1) ?? null, kind: set ?? auto, manual: Boolean(set), summary: titles[tab.id]?.text ?? null, summaryShort: titles[tab.id]?.short ? words(titles[tab.id].short, 5) : null });
    }
  }
  return { info, prs };
}

// Stamps each new working stretch. Idempotent, so every copy may call it.
export function trackRuns() {
  const runs = shared("task.runs") ?? {};
  let next = null;
  for (const s of spaces()) {
    for (const tab of s.tabs) {
      const w = tab.working_since;
      if (!w || (runs[tab.id] ?? []).includes(w)) continue;
      next ??= { ...runs };
      next[tab.id] = [...(runs[tab.id] ?? []), w].slice(-30);
    }
  }
  if (next) setShared("task.runs", next);
}

const QUERY = `query { viewer { pullRequests(states: [OPEN, MERGED], first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes {
  number title url headRefName isDraft reviewDecision updatedAt state repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`;

// PRs that an agent's Claude Code session made, oldest first: refreshSessionPrs() keeps them per
// terminal address. Only PRs in your PR list (task.prs) count, so each has its status.
const madePrs = (addr, prs) => {
  const urls = (shared("task.sessionPrs") ?? {})[addr]?.urls ?? [];
  return urls.map((u) => prs.find((p) => p.url === u)).filter(Boolean);
};
// The newest open PR, else the newest one.
const newest = (list) => [...list].reverse().find((p) => !p.merged) ?? list.at(-1) ?? null;

// A session can open a PR for a branch that no pane is on (a worktree it only cd's into).
// So the PR comes from the tool call that made it: a Bash `gh pr create`, or a GitHub MCP
// "create_pull_request" tool, and the PR URL in that call's own result. A PR you only
// mention in chat never counts.
// Step 1 ($1 transcript, $2 its size at the last scan): the size, then the tool-call lines.
const MADE_CALLS = `size=$(wc -c < "$1" | tr -d ' '); echo "$size"; [ "$size" = "$2" ] && exit 0
grep -F -e 'gh pr create' -e 'create_pull_request' "$1" | grep -F '"type":"tool_use"' || true`;
// Step 2 ($1 transcript, then tool-call ids): the last PR URL in each call's result.
const MADE_URLS = `f=$1; shift; for id in "$@"; do
  grep -F "\\"tool_use_id\\":\\"$id\\"" "$f" | grep -oE 'https://github\\.com/[^/" ]+/[^/" ]+/pull/[0-9]+' | tail -1
done`;
async function scanSessionPrs(file, size) {
  const r = await exec("sh", ["-c", MADE_CALLS, "sh", file, String(size ?? "")]);
  const [head, ...lines] = r.stdout.split("\n");
  if (r.code !== 0 || head.trim() === String(size)) return null; // unchanged or unreadable
  const ids = [];
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
      if (c.type !== "tool_use") continue;
      if ((c.name === "Bash" && /\bgh pr create\b/.test(c.input?.command ?? "")) || /create_pull_request/i.test(c.name ?? "")) ids.push(c.id);
    }
  }
  const u = ids.length ? await exec("sh", ["-c", MADE_URLS, "sh", file, ...ids]) : { stdout: "" };
  return { size: Number(head.trim()), urls: [...new Set(u.stdout.split("\n").filter(Boolean))] };
}

// Every copy calls it each minute; a 50 s stamp makes one of them run. Only live agents;
// a transcript is read again only when its size changed. Also publishes each agent's transcript
// path (shared "task.transcripts"), so the titles and the Context panel (mods/context) don't
// look it up again.
export async function refreshSessionPrs() {
  if (Date.now() - (shared("task.sessionPrsAt") ?? 0) < 50000) return;
  setShared("task.sessionPrsAt", Date.now());
  const live = terminals().filter((t) => t.state === "live" && t.program?.agent);
  const old = shared("task.sessionPrs") ?? {};
  const next = {}, paths = {};
  for (const t of live) {
    const prev = old[t.address];
    try {
      const file = await findTranscript(t.address);
      if (!file) continue;
      paths[t.address] = file;
      const got = await scanSessionPrs(file, prev?.file === file ? prev.size : null);
      const keep = got ? { file, ...got } : prev;
      if (keep) next[t.address] = keep;
    } catch { if (prev) next[t.address] = prev; }
  }
  setShared("task.sessionPrs", next);
  setShared("task.transcripts", paths);
}

// Unused worktrees (merged PR, or closed and all pushed) go: bin/herdr-worktree-gc,
// log in ~/.herdr/worktree-gc.log. Every 5 minutes; the stamp makes one copy run it.
export async function cleanWorktrees() {
  if (Date.now() - (shared("task.gcAt") ?? 0) < 290000) return;
  setShared("task.gcAt", Date.now());
  await exec("sh", ["-c", '"$1/bin/herdr-worktree-gc" >/dev/null 2>&1', "sh", appHome()]).catch(() => null);
}

// Your open PRs. Every copy calls this on a timer; the `at` stamp makes only one of them fetch.
// minAge: skip when the last fetch started less than that many ms ago (true: fetch now).
export async function refreshPrs(minAge = 50000) {
  const cur = shared("task.prs") ?? {};
  if (minAge !== true && Date.now() - (cur.at ?? 0) < minAge) return;
  setShared("task.prs", { ...cur, at: Date.now() });
  try {
    const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`]);
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

// An unnamed worktree space is named after its folder, the branch (ABC-4102): show its repo.
// Long repo names take row space. repoAliases in lasso.json (app folder) can give each a
// short name: { "my-long-service": "svc" }. No file or no alias: the full name. Not in
// settings.json: settings() gives only the app's own keys. Read again with each refresh.
let aliases = {};
export async function loadAliases() {
  const text = await readTextFile(`${appHome()}/lasso.json`).catch(() => null);
  try { aliases = text ? JSON.parse(text).repoAliases ?? {} : {}; } catch { /* bad JSON: keep the last good aliases */ }
}
export const repoAlias = (repo) => aliases[repo] ?? repo;
// Whether a label is one of your aliases (shown as you wrote it, not shortened).
export const isAlias = (label) => Object.values(aliases).includes(label);

// The repo a space works in: a worktree's (~/.herdr/worktrees/<repo>/…), else the space itself.
export const repoOf = (name, cwd) => cwd?.match(/\/\.herdr\/worktrees\/([^/]+)\//)?.[1] ?? name;

export const spaceLabel = (name, cwd) => {
  const m = cwd?.match(/\/\.herdr\/worktrees\/([^/]+)\/([^/]+)/);
  return repoAlias(m && m[2] === name ? m[1] : name);
};

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}


// One agent's own status, the same for a parent and a child: its pane's, else (a parked child,
// no pane) the core's. Never its tab's: a tab's status is its most urgent agent, so a parent would
// show its child's. "done" turns idle once you look, which needs a pane: a parked "done" is idle.
// `p` is the agent's pane (panes()), `k` its terminal (terminals()), either may be missing.
export function statusOf(p, k) {
  if (p?.status) return p.status;
  const s = k?.status ?? "idle";
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
}

// A child agent's own label, not its tab's: the short title Haiku wrote for it
// (refreshTitles), else the title the agent set (Claude Code names its session after its
// first message), else null (the caller uses the hc name). Never the PR title: the PR is the
// chip, as for tabs. `addr` is the child's address, `l` its pane (undefined when parked), `prs` the
// open PRs from context().
export function childLabel(addr, l, prs) {
  const pr = (l?.branch && !DEFAULT_BRANCHES.has(l.branch) ? prs.find((p) => p.branch === l.branch) : null) ?? newest(madePrs(addr, prs));
  const own = (shared("task.titles") ?? {})[addr]?.short;
  return { pr, text: own || liveTitle(l) };
}

// Looking at a done agent makes it idle; it stays with Done until you leave it rather than
// drop away under you. Any other change moves it at once. (Stock agents had this until 0.1.14;
// lasso keeps it.) `view` is the Agents view: holdDone(this, list) each render, heldRank for rank().
export function holdDone(view, list) {
  const cur = list.find((a) => a.focused);
  const same = cur && cur.address === view.held?.address;
  // Arriving, or any change but done turning idle, sets what it was.
  if (!same || cur.status !== "idle") view.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
}

export function heldRank(view, a) {
  const sawDone = a.address === view.held?.address && view.held.rank === RANK.done && a.status === "idle";
  return sawDone ? RANK.done : RANK[a.status] ?? 0;
}
