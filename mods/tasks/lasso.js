// lasso's additions to the shipped `agents` mod. main.js stays Herdr's file plus one-line hooks
// into this one (as `L.*`), so `herdr-mods-sync` can merge upstream changes into it cleanly.
// The data work is in work.js, the titles in titles.js, the looks in look.js, the Work board in board.js.
//
// Each tab has a kind (ship / loop / side), automatic or set by you (work.js). Click a row's
// tag, right-click a row, or press `tasks.cycle` to set it; "By kind" sorts by it. With props
// { board: true } this mod is the Work board instead (board.js); { nav: true } the Work row at
// the top of the sidebar, { boardBar: true } the board's bar, { kindMenu } the kind popup.
// Rows are 32px, as in tasks-spaces. A viewed done agent stays in Done until left.
// An agent stuck on a screen before it starts (trust, login, MCP approval) reports no status,
// so Herdr doesn't list it: withSetup() adds it as "Needs you" (setup rows).

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, focused, props, closeOverlay, openOverlay, nextCommand, panes, spaces, terminals, knownAgents, shared, setShared, checking, setBadge } from "herdr";
import { repoOf, KINDS, AUTO, RANK, setKind, context, statusOf, trackRuns, refreshPrs, refreshSessionPrs, cleanWorktrees, loadAliases, repoAlias, childLabel, spaceLabel } from "./work.js";
import { refreshTitles, leadPanes, shortTitle } from "./titles.js";
import { spaceCard, solid, fadeText, statusIcon, statusMark, icon, repoSpace, forget } from "./look.js";
import { board, bar, boardShown, showBoard, toggleBoard, summary, prChip } from "./board.js";
export { holdDone, heldRank } from "./work.js";
export { statusOf, statusMark, forget };

export const KIND_SORT = { id: "kind", label: "By kind", icon: "archive" };

// A tab's kind; a tab without one yet is a side task. `info`: context().info, when already read.
const kindOf = (tab, info = context().info) => info.get(tab) ?? { kind: KINDS[2], manual: false };
// Auto → ship → loop → side → auto.
function cycleKind(tab) {
  const { kind, manual } = kindOf(tab);
  setKind(tab, manual ? KINDS[KINDS.indexOf(kind) + 1]?.id ?? AUTO.id : KINDS[0].id);
}

// From init, after the stock popups returned. Sidebar and board both keep the data fresh; the
// work is idempotent or leased (work.js). True for the board pages, which keep no list state.
export function initWork(cx) {
  const page = !!(props()?.board || props()?.nav || props()?.boardBar);
  // `herdr-app check` runs init for real: no gh, claude or worktree cleanup from a check.
  if (checking()) return page;
  trackRuns();
  cx.timer.every(5000, () => trackRuns());
  // PRs first: a tab with a PR uses its title, and titles are the slow part.
  const refresh = async () => { await loadAliases(); await refreshPrs(); await refreshSessionPrs(); await refreshTitles(); await cleanWorktrees(); };
  cx.spawn(refresh);
  cx.timer.every(60000, (cx) => cx.spawn(refresh));
  if (page) {
    cx.timer.every(30000, (cx) => cx.notify());
    return true;
  }
  badge(cx);
  return false;
}

// The Dock badge: how many agents need you, as on the Work row. Only the sidebar copy sets it.
function badge(cx) {
  let last;
  const set = () => {
    const { blocked } = summary();
    const text = blocked ? String(blocked) : null;
    if (text !== last) { last = text; setBadge(text); }
  };
  set();
  cx.timer.every(2000, () => set());
}

// Keys: `tasks.cycle` sets the focused tab's kind, `tasks.board` opens the Work board.
// Only the sidebar copy listens, so a shown board doesn't act twice.
export function listenKeys(cx) {
  // A setup row shows SETUP_MS after its pane does: look again while one is pending.
  cx.spawn(async () => { try { for (const a of await knownAgents()) if (a.run?.[0]) agentCommands.add(a.run[0].split("/").pop()); } catch {} });
  cx.timer.every(2000, (cx) => { if (silentPanes().length) cx.notify(); });
  cx.spawn(async () => {
    for (;;) {
      const c = await nextCommand();
      if (c === "cycle") cycleKind(focused()?.tab);
      if (c === "board") toggleBoard();
    }
  });
}

// Agent panes (Claude, Codex, ...) whose program reports no status yet. An agent reports once
// it starts; before that it may sit on a screen that needs you: Claude's "trust this folder?",
// its login, first-run setup, a repo's MCP server approval. Those never show in agents().
const SETUP_MS = 5000; // a normal start reports well within this
const firstSeen = new Map(); // terminal → when its silent pane was first seen (this session)
// An agent pane: Herdr names it one (lasso starts agents directly), or its command line runs
// one. A tab Herdr opens with an agent runs it inside the login shell (`fish -lic ... claude`),
// so before the agent reports, the pane's program is the shell. Commands: Herdr's known agents.
const agentCommands = new Set(["claude"]);
const runsAgent = (argv) => (argv ?? []).some((x) => agentCommands.has(String(x).split("/").pop()));
function silentPanes() {
  const quiet = panes().filter((p) => p.terminal && !p.status);
  if (!quiet.length) return quiet;
  const argv = new Map(terminals().map((t) => [t.address, t.argv]));
  return quiet.filter((p) => p.program?.agent || runsAgent(argv.get(p.terminal)));
}

// agents() plus a "Needs you" row for each agent pane silent for SETUP_MS. Click: its pane.
export function withSetup(list) {
  const now = Date.now();
  const silent = silentPanes();
  for (const t of [...firstSeen.keys()]) if (!silent.some((p) => p.terminal === t)) firstSeen.delete(t);
  const rows = [];
  for (const p of silent) {
    if (!firstSeen.has(p.terminal)) firstSeen.set(p.terminal, now);
    if (now - firstSeen.get(p.terminal) < SETUP_MS || list.some((a) => a.address === p.terminal)) continue;
    const space = spaces().find((s) => s.tabs.some((tab) => tab.id === p.tab));
    const tabIndex = space?.tabs.findIndex((tab) => tab.id === p.tab) ?? -1;
    rows.push({
      address: p.terminal, pane: p.pane, space: space?.id ?? "", space_name: space?.name ?? "",
      tab: p.tab, tab_index: tabIndex, tab_name: space?.tabs[tabIndex]?.name ?? "",
      status: "blocked", app: null, program: p.program?.agent ? p.program : { ...p.program, name: "Agent" }, title: p.title, seq: 0, pinned: false,
      focused: p.focused, setup: true,
    });
  }
  return rows.length ? [...list, ...rows] : list;
}

// The pages this mod draws besides the agents list, or null for the list.
export function page(view, t, narrow) {
  const p = props() ?? {};
  if (p.kindMenu) return kindMenu(view, t);
  if (p.board) return board(view, t);
  if (p.nav) return nav(t, narrow);
  if (p.boardBar) return bar(t);
  return null;
}

// A popup list with a check on the current entry, built like Herdr's own menu (mods/menu): same
// rows, keys (up, down, enter, escape) and no title. Entries have an svg `icon` or a colored `dot`;
// an entry with `cmd` runs that command instead of being picked. `view` keeps the keyboard row.
function pickMenu(view, t, entries, on, pick) {
  if (view.at == null) view.at = Math.max(0, entries.findIndex((s) => s.id === on));
  const choose = (s) => {
    closeOverlay(props().overlay);
    s.cmd ? run(s.cmd, s.args) : pick(s);
  };
  return v_flex()
    .id("pick-menu")
    .track_focus(view.handle)
    .w_full()
    .min_h(0)
    .p(5)
    .bg(t.popover)
    .text_size(12.8)
    .on_key_down((e, cx) => {
      if (e.key === "down") view.at = (view.at + 1) % entries.length;
      else if (e.key === "up") view.at = (view.at + entries.length - 1) % entries.length;
      else if (e.key === "enter") return choose(entries[view.at]);
      else if (e.key === "escape") return closeOverlay(props().overlay);
      else return;
      cx.notify();
    })
    .children(entries.flatMap((s, i) => [...(s.sep ? [div().mx(7).my(4).h(1).bg(t.border)] : []), h_flex()
      .id(`pick-${s.id}`)
      .h(31)
      .px(8)
      .gap(9)
      .items_center()
      .rounded(7)
      .text_color(t.foreground)
      .when(i === view.at, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .on_click(() => choose(s))
      .child(s.icon
        ? svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted)
        : div().size(8).mx(3).flex_none().rounded(4).bg(t[s.dot] ?? t.dim))
      .child(div().flex_1().child(s.label))
      .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))]));
}

// From the tab bar (props.tabSpace) it also keeps the shipped tab menu's items.
function kindMenu(view, t) {
  const { kindMenu: tab, tabSpace, pin } = props();
  const { kind, manual } = kindOf(tab);
  const items = [...KINDS, { ...AUTO, label: `Auto (${kind.label.toLowerCase()} now)` }].map((k) => ({ ...k, dot: k.color }));
  if (manual) items[3].label = "Auto";
  if (tabSpace) items.push(
    { id: "rename", label: "Rename", icon: "square-pen", sep: true, cmd: "tab.rename", args: { id: tab } },
    { id: "new", label: "New tab", icon: "plus", cmd: "tab.new", args: { space: tabSpace } },
    { id: "close", label: "Close", icon: "x", cmd: "tab.close", args: { id: tab } },
  );
  // From an agent row (props.pin): pin or unpin that agent.
  if (pin) items.push({ id: "pin", label: pin.pinned ? "Unpin" : "Pin to the top", icon: pin.pinned ? "pin-off" : "pin", sep: true, cmd: "terminal.pin", args: { terminal: pin.terminal, pinned: !pin.pinned } });
  return pickMenu(view, t, items, manual ? kind.id : AUTO.id, (k) => setKind(tab, k.id));
}

const openKindMenu = (tab, pin = null) =>
  openOverlay({ mod: "tasks", kind: "popup", width: 200, height: pin ? 174 : 134, at: "pointer", props: { kindMenu: tab, pin } });

// The Work tile: a violet-to-pink gradient with a soft gloss and a white check. Its motion says
// how work is going: still when every agent rests, a slow drift of pink and indigo washes while
// agents work, and warmer and quicker when something needs you. Native loops only (no timer, no
// redraws). Painted paths ignore a parent's opacity, so the moving layers are plain fills.
const ROUNDED18 = () => PathBuilder.fill().move_to(5, 0).line_to(13, 0).arc_to(5, 5, 0, false, true, 18, 5).line_to(18, 13)
  .arc_to(5, 5, 0, false, true, 13, 18).line_to(5, 18).arc_to(5, 5, 0, false, true, 0, 13).line_to(0, 5)
  .arc_to(5, 5, 0, false, true, 5, 0).close().build();
const paint = (angle, from, to) => globalThis.window.paint_path(ROUNDED18(), Background.linear_gradient(angle, from, to)).absolute().top(0).left(0).size_full();
const wash = (id, color, to, period) => div().id(`wash-${id}`).absolute().top(0).left(0).size_full().rounded(5).bg(color).loop("opacity", { from: 0, to, period });
const workTile = (mood) => h_flex().relative().size(18).flex_none().items_center().justify_center()
  .child(mood === "needs" ? paint(135, "#a855f7", "#f43f5e") : paint(135, "#8b5cf6", "#ec4899"))
  .when(mood === "busy", (el) => el.child(wash("busy-pink", "#f472b6", 0.45, 4600)).child(wash("busy-indigo", "#818cf8", 0.3, 3100)))
  .when(mood === "needs", (el) => el.child(wash("needs-rose", "#fb7185", 0.5, 2400)).child(wash("needs-fuchsia", "#e879f9", 0.3, 1700)))
  .child(paint(180, "#ffffff38", "#ffffff00"))
  .child(svg("mods/workspace-chrome/check.svg").size(11).text_color("#ffffff"));

// The Work row at the top of the sidebar. Same measures as a space row in tasks-spaces
// (32px, 13px text, 18px filled tile, 11.5px dim tail). Click: board on/off.
function nav(t, narrow) {
  const on = boardShown();
  const { total, blocked, working } = summary();
  const mood = blocked ? "needs" : working ? "busy" : "calm";
  const tile = () => workTile(mood);
  const base = (el) => el.id("work-nav").h(32).items_center().rounded(8)
    .when(on, (el) => el.bg(t.selected))
    .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
    .tooltip("Work board (⌘K)")
    .on_click(() => toggleBoard());
  if (narrow) {
    // The rail: the same tile as the full row, centered.
    return v_flex().size_full().bg(t.chrome).text_size(13).justify_center().child(base(h_flex().mx(8).justify_center().gap(4))
      .child(tile())
      .when(blocked > 0, (el) => el.child(div().text_color(t.blocked).child("●"))));
  }
  return v_flex().size_full().bg(t.chrome).text_size(13).px(8).justify_center().child(base(h_flex().px(8).flex_none().gap(9))
    .child(tile())
    .child(div().flex_shrink(0).text_color(t.foreground).child("Work"))
    .child(h_flex().flex_1().min_w(0).gap(5).justify_end().items_center().text_size(11.5).text_color(t.dim)
      .when(blocked > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`● ${blocked} need${blocked === 1 ? "s" : ""} you`)))
      .when(blocked === 0 && total > 0, (el) => el.child(div().flex_none().child(String(total))))));
}

// Picking an agent leaves the board.
function focusPane(pane) {
  run("pane.focus", { pane });
  showBoard(false);
}

// Per render: each tab's kind and PR, each terminal's pane, the space names with repo aliases,
// whether the board shows, and the space hovered in the spaces list (shared "space.hover"). Reads panes once: every host read copies the whole list into JS.
export function kinds(view, sort) {
  const paneList = panes();
  const ctx = context(paneList);
  // For the nested rows (subRow) and the child labels published by labels().
  view.prs = ctx.prs;
  view.paneOf = new Map(paneList.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const kindAt = (tab) => kindOf(tab, ctx.info);
  const allSpaces = spaces(), hoverSpace = shared("space.hover") ?? null;
  return {
    onBoard: boardShown(), // on the board, no row is the current place
    allSpaces,
    hoverSpace,
    hovered: hoverSpace ? allSpaces.find((s) => s.id === hoverSpace) : null,
    byKind: sort.id === KIND_SORT.id,
    kindAt,
    // The repo an agent works in (its worktree's repo, else its space's name), unaliased.
    repoName: (a) => repoOf(a.space_name, view.paneOf.get(a.address)?.cwd),
    info: ctx.info,
    paneList,
    spaceName: (a) => spaceLabel(a.space_name, view.paneOf.get(a.address)?.cwd),
    order: (x, y) => KINDS.indexOf(kindAt(x.tab).kind) - KINDS.indexOf(kindAt(y.tab).kind),
  };
}

// After the stock priority sort: lasso's order. By kind, a steady order inside each group (newest
// agent first; only what needs you rises), and pinned agents first. While the pointer is over the
// list, the order holds still: nothing moves under the cursor; status dots stay live, and the list
// re-sorts when the pointer leaves. Whether the pointer is over it is asked of the window (a popup
// can end a hover while the pointer stays put), against the bounds the list learns from the
// pointer moving over it (watchList). `rank`: an agent's rank for its group, the held one while held.
export function holdStill(view, list, K, byPriority, rankOf) {
  const needs = (a) => (rankOf(a) === RANK.blocked ? 1 : 0);
  if (K.byKind) list = [...list].sort((x, y) => K.order(x, y) || needs(y) - needs(x) || y.seq - x.seq);
  list = [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];
  const b = view.listBounds, p = b && globalThis.window.mouse_position();
  const holding = Boolean(p && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
  if (holding && view.frozen) {
    // Held, an agent still sorts into its group first (a new one, or one whose kind just
    // changed, joins its group rather than starting a second one); within it, it keeps its place.
    const at = new Map(view.frozen.order.map((x, i) => [x, i]));
    const spaceAt = new Map(); // each space at its first held place
    for (const x of view.frozen.order) { const sp = list.find((a) => a.address === x)?.space; if (sp && !spaceAt.has(sp)) spaceAt.set(sp, spaceAt.size); }
    const group = (x, y) => byPriority ? (view.frozen.rank.get(y.address) ?? rankOf(y)) - (view.frozen.rank.get(x.address) ?? rankOf(x))
      : K.byKind ? K.order(x, y) : (spaceAt.get(x.space) ?? 1e9) - (spaceAt.get(y.space) ?? 1e9);
    list = [...list].sort((x, y) => Number(y.pinned) - Number(x.pinned) || (x.pinned ? 0 : group(x, y)) || (at.get(x.address) ?? 1e9) - (at.get(y.address) ?? 1e9));
  } else view.frozen = { order: list.map((a) => a.address), rank: new Map(list.map((a) => [a.address, rankOf(a)])) };
  return { list, rank: (a) => (holding ? view.frozen.rank.get(a.address) : null) ?? rankOf(a) };
}

// The agents list learns its bounds for holdStill. Leaving (or seeming to): look again shortly,
// and re-sort if the pointer is really gone.
export const watchList = (view, el) => el
  .on_mouse_move((e) => { view.listBounds = e.bounds; })
  .on_hover((on, cx) => { if (!on) cx.timer.after(120, (cx) => cx.notify()); });

// Each row's label, written over the stock ones in `into` (stock title()): the tab's short title,
// or with two listed agents in one tab, each its own. Also publishes the short titles for the tab bar and pane
// headers (tasks-tabs, tasks-pane), as mods can't import each other's files.
export function labels(view, K, list, tabCounts, all, into) {
  const leads = leadPanes(K.paneList);
  const tabLabels = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, shortTitle(tab, leads.get(tab.id), K.info.get(tab.id))]));
  // Written only on a change.
  const shorts = Object.fromEntries([...tabLabels].filter(([id]) => leads.has(id)));
  if (JSON.stringify(shorts) !== JSON.stringify(shared("task.short") ?? {})) setShared("task.short", shorts);
  // The same for child agents, by terminal (tasks-pane): "" means no label yet.
  const kidLabels = Object.fromEntries(all.filter((k) => k.parent && k.state === "live").map((k) => [k.address, childLabel(k.address, view.paneOf.get(k.address), view.prs).text || k.name || ""]));
  if (JSON.stringify(kidLabels) !== JSON.stringify(shared("task.child") ?? {})) setShared("task.child", kidLabels);
  // The tab's name and summary are about its lead agent only.
  const tabById = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
  const own = (a) => shortTitle({ ...tabById.get(a.tab), named: false }, view.paneOf.get(a.address) ?? a, { branch: K.info.get(a.tab)?.branch });
  for (const a of list) into.set(a.address, a.setup ? "waiting on setup" : tabCounts.get(a.tab) > 1 && tabById.has(a.tab) ? own(a) : tabLabels.get(a.tab) ?? (a.title || a.program?.name || ""));
}

// lasso draws every agent status the same way (statusMark, statusIcon): stock status() returns
// statusMark on this flag, so main.js keeps its stock code.
export const OWN_STATUS = true;

// The rail: the agent's icon (carrying its status), centered; its space (or label) as a tooltip.
function railRow(a, t, pic, tip, onBoard) {
  return h_flex()
    .id(`ag-${a.address}`)
    .h(32)
    .mx(8)
    .flex_none()
    .items_center()
    .justify_center()
    .gap(6)
    .rounded(8)
    .when(a.focused && !onBoard, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .tooltip(tip)
    .on_click(() => focusPane(a.pane))
    .child(statusIcon(t, a.address, a.status, a.focused, pic));
}

// An agent's row (replaces the stock row): its icon (which carries its status), title and PR chip.
// Kind and time are left off; the title gets the rest of the row on one line. No pin button:
// right-click has it (the kind menu). `x` is what the stock row worked out, and its `fold`.
export function row(view, t, a, subs, { pic, more, machine, collapsed, byPriority, K, label, fold }) {
  if (collapsed) return railRow(a, t, pic, K.spaceName(a) || label(a), K.onBoard);
  const idle = a.status === "idle" && !a.focused;
  const isPinned = a.pinned;
  // Under a space header the space goes without saying; an automatic tab number says nothing.
  // Without a space header above (priority, by kind, pinned) the row names its space.
  const full = byPriority || K.byKind || isPinned;
  const name = full ? K.spaceName(a) || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
  // A row without a space header above names its repo: a card with its code, in its color.
  const repo = K.repoName(a);
  const tile = full && more ? spaceCard(t, repoSpace(K.allSpaces, repo, a.space), repo, repoAlias(repo)) : null;
  const text = tile ? more : name;
  // Hovering a space in the spaces list (shared "space.hover") dims the other spaces' agents.
  // Hovering a repo's space lights all its agents, in any worktree; a worktree's space, its own.
  const away = Boolean(K.hovered) && a.space !== K.hoverSpace && repo !== K.hovered.name;
  // The color the row really shows, for its title's fade: chrome, hover under the selected
  // layer, and all of it at 35% over chrome when dimmed (a painted fade can't be dimmed).
  let rowBg = view.hovered === a.address ? solid(t.hover, t.chrome) : solid(t.chrome, t.chrome);
  if (a.focused && !K.onBoard) rowBg = solid(t.selected, rowBg);
  if (away) rowBg = solid(rowBg + "59", t.chrome);
  const pr = K.kindAt(a.tab).pr;
  return h_flex()
    .id(`ag-${a.address}`)
    .relative()
    .opacity(away ? 0.35 : 1)
    .transition("opacity", 160)
    .px(8)
    .h(32)
    .flex_none()
    .rounded(8)
    .items_center()
    .gap(9)
    // The selected highlight is a layer that eases in and out, so a click doesn't snap.
    .child(div().id(`ag-sel-${a.address}`).absolute().top(0).left(0).size_full().rounded(8).bg(t.selected)
      .opacity(a.focused && !K.onBoard ? 1 : 0).transition("opacity", 180))
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_hover((on, cx) => {
      if (on) view.hovered = a.address;
      else if (view.hovered === a.address) view.hovered = null;
      cx.notify();
    })
    .on_click(() => focusPane(a.pane))
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openKindMenu(a.tab, { terminal: a.address, pinned: isPinned }); })
    .child(div().id(`agent-fold-${a.address}`)
      .when(subs.length > 0, el => el.on_click((_e, cx) => {
        cx.stop_propagation();
        view.folded.has(a.address) ? view.folded.delete(a.address) : view.folded.add(a.address);
        cx.notify();
      })).child(statusIcon(t, a.address, a.status, a.focused, pic)))
    .child(div().id(`ag-title-${a.address}`).flex_1().min_w(0).flex().items_center().gap(7).when(Boolean(tile), (el) => el.child(tile)).text_color(idle ? t.muted : t.foreground)
      .child(fadeText(text, rowBg, `ag-${a.address}`, view)))
    .when(Boolean(machine), el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(machine)))
    .when(subs.length > 0, el => el.child(fold(a, subs)))
    .when(Boolean(pr), (el) => el.child(prChip(t, pr)));
}

export const kindGroup = (id, k, a) => ({ id, label: k.label, status: null, color: k.color, members: [a] });

// A sub-agent's row (replaces the stock subRow): 32px like every row, its icon carries its own
// status, and it shows its own label (its Haiku title or PR), not its tab's.
export function subRow(view, t, s, shown) {
  const k = s.t;
  const st = statusOf({ status: view.listed.get(k.address) }, k);
  const on = k.address === shown;
  const own = childLabel(k.address, view.paneOf?.get(k.address), view.prs ?? []);
  return h_flex()
    .id(`sub-${k.address}`)
    .pl(39)
    .pr(8)
    .rounded(8)
    .h(32)
    .flex_none()
    .gap(0)
    .items_center()
    .text_size(12.5)
    .when(on, (el) => el.bg(t.raised))
    .hover((s) => s.bg(t.hover))
    .on_click(() => (view.listed.has(k.address) ? run("agent.focus", { terminal: k.address }) : view.peek(k.address)))
    .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(20).mr(4).flex_none()
      .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
      .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
    .child(div().mr(8).child(statusIcon(t, k.address, st, on, icon(k.program, 14, t.foreground))))
    .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).tooltip(k.name || k.address).child(own.text || k.name || k.template || k.program?.name || k.address))
    .when(Boolean(own.pr), (el) => el.child(div().mx(6).child(prChip(t, own.pr))));
}
