// lasso's additions to the stock `agents` mod: main.js calls these from one-line hooks (L.*).
// work.js has the data, titles.js the titles, look.js the looks, board.js the Work board.
//
// With props, this mod draws another page instead of the agents list (page()):
// { board } the Work board, { nav } the Work row at the top of the sidebar,
// { boardBar } the board's bar, { kindMenu } the kind popup.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, focused, props, closeOverlay, nextCommand, panes, spaces, terminals, knownAgents, shared, setShared, checking, setBadge } from "herdr";
import { repoOf, KINDS, AUTO, RANK, setKind, kindOf, kindItems, openKindMenu, context, statusOf, trackRuns, refreshPrs, refreshSessionPrs, cleanWorktrees, repoAlias, childLabel, spaceLabel } from "./work.js";
import { refreshTitles, leadPanes, shortTitle } from "./titles.js";
import { spaceCard, statusIcon, statusMark, icon, repoSpace, forget } from "./look.js";
import { solid, fadeText, tintOf, workingTitle, loadConf, boardShown } from "./shared.js";
import { board, bar, showBoard, toggleBoard, agentCounts, summary, prChip } from "./board.js";
export { holdDone, heldRank } from "./work.js";
export { statusOf, statusMark, forget };

export const KIND_SORT = { id: "kind", label: "By kind", icon: "archive" };
// main.js returns statusMark() on this flag, so its stock status code stays in place.
export const OWN_STATUS = true;
export const kindGroup = (id, kind, agent) => ({ id, label: kind.label, status: null, color: kind.color, members: [agent] });

// Auto → the first kind → the next ones → auto.
function cycleKind(tab) {
  const { kind, manual } = kindOf(tab, context().info);
  setKind(tab, manual ? KINDS[KINDS.indexOf(kind) + 1]?.id ?? AUTO.id : KINDS[0].id);
}

// Starts the timers that keep the shared data fresh. Every copy does: the work is idempotent
// or one copy's turn (work.js). Returns true for the pages, which keep no list state.
export function initWork(cx) {
  const isPage = Boolean(props()?.board || props()?.nav || props()?.boardBar);
  // `herdr-app check` runs init for real: no gh, claude or worktree cleanup from a check.
  if (checking()) return isPage;
  trackRuns();
  cx.timer.every(5000, (cx) => { trackRuns(); cx.spawn(() => refreshPrs()); });
  // PRs first: a tab with a PR uses its title, and titles are the slow part.
  const refresh = async () => { await loadConf(); await refreshPrs(); await refreshSessionPrs(); await refreshTitles(); await cleanWorktrees(); };
  cx.spawn(refresh);
  cx.timer.every(60000, (cx) => cx.spawn(refresh));
  if (isPage) {
    cx.timer.every(30000, (cx) => cx.notify()); // the "5m ago" texts
    return true;
  }
  dockBadge(cx);
  return false;
}

// The Dock badge: how many agents need you. Only the sidebar copy sets it.
function dockBadge(cx) {
  let last;
  const update = () => {
    const { blocked } = agentCounts();
    const text = blocked ? String(blocked) : null;
    if (text !== last) { last = text; setBadge(text); }
  };
  update();
  cx.timer.every(2000, update);
}

// Keys: `tasks.cycle` sets the focused tab's kind, `tasks.board` opens the Work board.
// Only the sidebar copy listens, so a shown board doesn't act twice.
export function listenKeys(cx) {
  cx.spawn(async () => {
    try { for (const agent of await knownAgents()) if (agent.run?.[0]) agentCommands.add(agent.run[0].split("/").pop()); } catch {}
  });
  // A setup row shows SETUP_MS after its pane does: look again while one is pending.
  cx.timer.every(2000, (cx) => { if (silentPanes().length) cx.notify(); });
  cx.spawn(async () => {
    for (;;) {
      const command = await nextCommand();
      if (command === "cycle") cycleKind(focused()?.tab);
      if (command === "board") toggleBoard();
    }
  });
}

// Setup rows. An agent reports a status only once it has started. Before that it may sit on a
// screen that needs you (trust this folder, login, MCP approval), and Herdr doesn't list it.
// So an agent pane that stays silent for SETUP_MS gets a "Needs you" row.
const SETUP_MS = 5000;
const firstSeen = new Map(); // terminal → when its silent pane was first seen
// An agent pane: Herdr says so, or its command line runs a known agent. (A tab Herdr opens
// with an agent runs it inside the login shell, so the pane's program is the shell at first.)
const agentCommands = new Set(["claude"]);
const runsAgent = (argv) => (argv ?? []).some((arg) => agentCommands.has(String(arg).split("/").pop()));
function silentPanes() {
  const silent = panes().filter((p) => p.terminal && !p.status);
  if (!silent.length) return silent;
  const argvOf = new Map(terminals().map((t) => [t.address, t.argv]));
  return silent.filter((p) => p.program?.agent || runsAgent(argvOf.get(p.terminal)));
}

// agents() plus the setup rows.
export function withSetup(list) {
  const now = Date.now();
  const silent = silentPanes();
  for (const terminal of [...firstSeen.keys()]) if (!silent.some((p) => p.terminal === terminal)) firstSeen.delete(terminal);
  const rows = [];
  for (const pane of silent) {
    if (!firstSeen.has(pane.terminal)) firstSeen.set(pane.terminal, now);
    if (now - firstSeen.get(pane.terminal) < SETUP_MS || list.some((a) => a.address === pane.terminal)) continue;
    const space = spaces().find((s) => s.tabs.some((tab) => tab.id === pane.tab));
    const tabIndex = space?.tabs.findIndex((tab) => tab.id === pane.tab) ?? -1;
    // The shape of an agents() entry, plus `setup`.
    rows.push({
      address: pane.terminal, pane: pane.pane, space: space?.id ?? "", space_name: space?.name ?? "",
      tab: pane.tab, tab_index: tabIndex, tab_name: space?.tabs[tabIndex]?.name ?? "",
      status: "blocked", app: null, program: pane.program?.agent ? pane.program : { ...pane.program, name: "Agent" },
      title: pane.title, seq: 0, pinned: false, focused: pane.focused, setup: true,
    });
  }
  return rows.length ? [...list, ...rows] : list;
}

// The page this copy draws instead of the agents list, or null for the list.
// Called first in every render, with its `cx`: also sets view.redrawIn for this render.
export function page(view, t, narrow, cx) {
  view.redrawIn = (ms) => cx.timer.after(ms, (cx) => cx.notify());
  const p = props() ?? {};
  if (p.kindMenu) return kindMenu(view, t);
  if (p.board) return board(view, t);
  if (p.nav) return nav(t, narrow);
  if (p.boardBar) return bar(t);
  return null;
}

// A popup list with a check on the current entry (`current`), built like Herdr's own menu
// (mods/menu). An entry has an svg `icon` or a colored `dot`; one with `cmd` runs that command
// instead of being picked. `view.at` is the keyboard row.
function pickMenu(view, t, entries, current, pick) {
  if (view.at == null) view.at = Math.max(0, entries.findIndex((entry) => entry.id === current));
  const close = () => closeOverlay(props().overlay);
  const choose = (entry) => {
    close();
    entry.cmd ? run(entry.cmd, entry.args) : pick(entry);
  };
  const row = (entry, i) => h_flex()
    .id(`pick-${entry.id}`)
    .h(31)
    .px(8)
    .gap(9)
    .items_center()
    .rounded(7)
    .text_color(t.foreground)
    .when(i === view.at, (el) => el.bg(t.selected))
    .hover((el) => el.bg(t.hover))
    .on_click(() => choose(entry))
    .child(entry.icon
      ? svg(`mods/workspace-chrome/${entry.icon}.svg`).size(14).flex_none().text_color(t.muted)
      : div().size(8).mx(3).flex_none().rounded(4).bg(t[entry.dot] ?? t.dim))
    .child(div().flex_1().child(entry.label))
    .when(entry.id === current, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)));
  const separator = () => div().mx(7).my(4).h(1).bg(t.border);
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
      else if (e.key === "escape") return close();
      else return;
      cx.notify();
    })
    .children(entries.flatMap((entry, i) => (entry.sep ? [separator(), row(entry, i)] : [row(entry, i)])));
}

function kindMenu(view, t) {
  const { kindMenu: tab, tabSpace, pin } = props();
  const { kind, manual } = kindOf(tab, context().info);
  return pickMenu(view, t, kindItems(tab, tabSpace, pin), manual ? kind.id : AUTO.id, (picked) => setKind(tab, picked.id));
}

// The Work tile: a gradient with a gloss and a white check. Its motion says how work is going:
// still when every agent rests, a slow drift while agents work, warmer and quicker when one
// needs you. Painted paths ignore a parent's opacity, so the moving layers are plain fills.
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

// The Work row at the top of the sidebar, sized like a space row. Click: board on/off.
function nav(t, narrow) {
  const shown = boardShown();
  const { total, blocked, working } = summary();
  const tile = workTile(blocked ? "needs" : working ? "busy" : "calm");
  const button = (el) => el.id("work-nav").h(32).items_center().rounded(8)
    .when(shown, (el) => el.bg(t.selected))
    .when(!shown, (el) => el.hover((s) => s.bg(t.hover)))
    .tooltip("Work board (⌘K)")
    .on_click(() => toggleBoard());
  const frame = v_flex().size_full().bg(t.chrome).text_size(13).justify_center();
  if (narrow) {
    return frame.child(button(h_flex().mx(8).justify_center().gap(4))
      .child(tile)
      .when(blocked > 0, (el) => el.child(div().text_color(t.blocked).child("●"))));
  }
  return frame.px(8).child(button(h_flex().px(8).flex_none().gap(9))
    .child(tile)
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

// What a render needs, read once (each host read copies a whole list). main.js keeps it as `K`
// and passes it to the hooks below.
export function kinds(view, sort) {
  const paneList = panes();
  const { info, prs } = context(paneList);
  view.prs = prs;
  view.paneOf = new Map(paneList.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const cwdOf = (agent) => view.paneOf.get(agent.address)?.cwd;
  const kindAt = (tab) => kindOf(tab, info);
  const allSpaces = spaces();
  // The space hovered in the spaces list (mods/tasks-spaces).
  const hoverSpace = shared("space.hover") ?? null;
  return {
    info, paneList, allSpaces, kindAt,
    onBoard: boardShown(), // on the board, no row is the current place
    hoverSpace,
    hovered: hoverSpace ? allSpaces.find((s) => s.id === hoverSpace) : null,
    byKind: sort.id === KIND_SORT.id,
    order: (x, y) => KINDS.indexOf(kindAt(x.tab).kind) - KINDS.indexOf(kindAt(y.tab).kind),
    repoName: (agent) => repoOf(agent.space_name, cwdOf(agent)),
    spaceName: (agent) => spaceLabel(agent.space_name, cwdOf(agent)),
  };
}

// lasso's order, after the stock priority sort: pinned agents first, and "By kind" groups by
// kind (inside a group: what needs you, then the newest agent).
// While the pointer is over the list, the order holds still, so nothing moves under the
// cursor; it re-sorts when the pointer leaves. A new agent still joins its group. Whether the
// pointer is over the list is asked of the window (a popup can end a hover while the pointer
// stays), against the bounds from watchList().
// Returns { list, rank }: rank(agent) is the agent's rank for its group, the held one while held.
export function holdStill(view, list, K, byPriority, rankOf) {
  const needsYou = (agent) => (rankOf(agent) === RANK.blocked ? 1 : 0);
  if (K.byKind) list = [...list].sort((x, y) => K.order(x, y) || needsYou(y) - needsYou(x) || y.seq - x.seq);
  list = [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];

  const bounds = view.listBounds, pointer = bounds && globalThis.window.mouse_position();
  const holding = Boolean(pointer && pointer.x >= bounds.x && pointer.x <= bounds.x + bounds.width
    && pointer.y >= bounds.y && pointer.y <= bounds.y + bounds.height);
  if (!holding || !view.frozen) {
    view.frozen = { order: list.map((a) => a.address), rank: new Map(list.map((a) => [a.address, rankOf(a)])) };
    return { list, rank: rankOf };
  }

  const LAST = 1e9;
  const place = new Map(view.frozen.order.map((address, i) => [address, i]));
  const spacePlace = new Map(); // each space at its first held place
  for (const address of view.frozen.order) {
    const space = list.find((a) => a.address === address)?.space;
    if (space && !spacePlace.has(space)) spacePlace.set(space, spacePlace.size);
  }
  const rank = (agent) => view.frozen.rank.get(agent.address) ?? rankOf(agent);
  const byGroup = (x, y) => byPriority ? rank(y) - rank(x)
    : K.byKind ? K.order(x, y)
    : (spacePlace.get(x.space) ?? LAST) - (spacePlace.get(y.space) ?? LAST);
  const byPlace = (x, y) => (place.get(x.address) ?? LAST) - (place.get(y.address) ?? LAST);
  list = [...list].sort((x, y) => Number(y.pinned) - Number(x.pinned) || (x.pinned ? 0 : byGroup(x, y)) || byPlace(x, y));
  return { list, rank };
}

// The agents list reports its bounds for holdStill. When the pointer leaves, render again
// shortly, so the list re-sorts.
export const watchList = (view, el) => el
  .on_mouse_move((e) => { view.listBounds = e.bounds; })
  .on_hover((over, cx) => { if (!over) cx.timer.after(120, (cx) => cx.notify()); });

const publish = (key, value) => { if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? {})) setShared(key, value); };

// Each row's label, written into `into` (the stock labels map): the tab's short title. Also
// publishes the short titles for the tab bar and pane headers (tasks-tabs, tasks-pane).
export function labels(view, K, list, tabCounts, allTerminals, into) {
  const leads = leadPanes(K.paneList);
  const tabs = spaces().flatMap((s) => s.tabs);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const tabLabels = new Map(tabs.map((tab) => [tab.id, shortTitle(tab, leads.get(tab.id), K.info.get(tab.id))]));
  publish("task.short", Object.fromEntries([...tabLabels].filter(([id]) => leads.has(id))));
  // Child agents, by terminal. "": no label yet.
  const liveKids = allTerminals.filter((k) => k.parent && k.state === "live");
  publish("task.child", Object.fromEntries(liveKids.map((k) => [k.address, childLabel(k.address, view.paneOf.get(k.address), view.prs).text || k.name || ""])));

  // Two listed agents in one tab each show their own title: the tab's name and summary are
  // about its lead agent only.
  const ownTitle = (agent) => shortTitle({ ...tabById.get(agent.tab), named: false }, view.paneOf.get(agent.address) ?? agent, { branch: K.info.get(agent.tab)?.branch });
  for (const agent of list) {
    const sharesTab = tabCounts.get(agent.tab) > 1 && tabById.has(agent.tab);
    const label = agent.setup ? "waiting on setup"
      : sharesTab ? ownTitle(agent)
      : tabLabels.get(agent.tab) ?? (agent.title || agent.program?.name || "");
    into.set(agent.address, label);
  }
}

// An agent on the collapsed rail: its icon with its status, `tip` as a tooltip.
function railRow(view, agent, t, pic, tip, onBoard, tint) {
  return h_flex()
    .id(`ag-${agent.address}`)
    .h(32)
    .mx(8)
    .flex_none()
    .items_center()
    .justify_center()
    .gap(6)
    .rounded(8)
    .when(agent.focused && !onBoard, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .tooltip(tip)
    .on_click(() => focusPane(agent.pane))
    .child(statusIcon(t, agent.address, agent.status, agent.focused, pic, tint, view.redrawIn));
}

// An agent's row (replaces the stock row): its icon with its status, its title and its PR
// chip. Right-click: the kind menu, with pin. The last argument is what the stock row worked out.
export function row(view, t, agent, subs, { more, machine, collapsed, byPriority, K, label, fold }) {
  const pic = icon(agent.program, t.foreground);
  const tint = tintOf(t, view.paneOf.get(agent.address)?.cwd, agent.space);
  const spaceName = K.spaceName(agent) || label(agent);
  if (collapsed) return railRow(view, agent, t, pic, spaceName, K.onBoard, tint);
  const selected = agent.focused && !K.onBoard;

  // Under a space header the row shows its label. Without one (priority, by kind, pinned) it
  // names its space: as a card in the repo's color when there is also a label, else as text.
  const noHeader = byPriority || K.byKind || agent.pinned;
  const repo = K.repoName(agent);
  const card = noHeader && more ? spaceCard(t, repoSpace(K.allSpaces, repo, agent.space), repo, repoAlias(repo)) : null;
  // An automatic tab number says nothing: the program's name instead.
  const ownLabel = /^\d+$/.test(label(agent)) ? agent.program?.name || label(agent) : label(agent);
  const text = card ? more : noHeader ? spaceName : more ?? ownLabel;

  // Hovering a space in the spaces list dims the agents of other spaces. A repo's space
  // keeps all its agents lit, in any worktree.
  const dimmed = Boolean(K.hovered) && agent.space !== K.hoverSpace && repo !== K.hovered.name;
  // The color the row really shows, for the title's fade (a painted fade can't be dimmed, so
  // a dimmed row gets its color at 35% over chrome).
  let rowBg = view.hovered === agent.address ? solid(t.hover, t.chrome) : solid(t.chrome, t.chrome);
  const working = agent.status === "working";
  if (selected) rowBg = solid(t.selected, rowBg);
  if (dimmed) rowBg = solid(rowBg + "59", t.chrome);

  const pr = K.kindAt(agent.tab).pr;
  const idle = agent.status === "idle" && !agent.focused;
  const toggleFold = (_e, cx) => {
    cx.stop_propagation();
    view.folded.has(agent.address) ? view.folded.delete(agent.address) : view.folded.add(agent.address);
    cx.notify();
  };
  return h_flex()
    .id(`ag-${agent.address}`)
    .relative()
    .opacity(dimmed ? 0.35 : 1)
    .transition("opacity", 160)
    .px(8)
    .h(32)
    .flex_none()
    .rounded(8)
    .items_center()
    .gap(9)
    // The selected highlight is a layer that eases in and out, so a click doesn't snap.
    .child(div().id(`ag-sel-${agent.address}`).absolute().top(0).left(0).size_full().rounded(8).bg(t.selected)
      .opacity(selected ? 1 : 0).transition("opacity", 180))
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_hover((over, cx) => {
      if (over) view.hovered = agent.address;
      else if (view.hovered === agent.address) view.hovered = null;
      cx.notify();
    })
    .on_click(() => focusPane(agent.pane))
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      openKindMenu(agent.tab, { pin: { terminal: agent.address, pinned: agent.pinned } });
    })
    .child(div().id(`agent-fold-${agent.address}`)
      .when(subs.length > 0, (el) => el.on_click(toggleFold))
      .child(statusIcon(t, agent.address, agent.status, agent.focused, pic, tint, view.redrawIn)))
    .child(div().id(`ag-title-${agent.address}`).flex_1().min_w(0).flex().items_center().gap(7)
      .text_color(idle ? t.muted : t.foreground)
      .when(Boolean(card), (el) => el.child(card))
      .child(fadeText(working ? workingTitle(agent.address, text, t, tint) : text, rowBg, `ag-${agent.address}`, view)))
    .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(machine)))
    .when(subs.length > 0, (el) => el.child(fold(agent, subs)))
    .when(Boolean(pr), (el) => el.child(prChip(t, pr)));
}

// A child agent's row (replaces the stock subRow): its own status and its own label, not its
// tab's. `sub` is the stock { t: terminal, lines: tree lines }.
export function subRow(view, t, sub, shown) {
  const kid = sub.t;
  const pane = view.paneOf?.get(kid.address);
  const status = statusOf({ status: view.listed.get(kid.address) }, kid);
  const selected = kid.address === shown;
  const own = childLabel(kid.address, pane, view.prs ?? []);
  return h_flex()
    .id(`sub-${kid.address}`)
    .pl(39)
    .pr(8)
    .rounded(8)
    .h(32)
    .flex_none()
    .gap(0)
    .items_center()
    .text_size(12.5)
    .when(selected, (el) => el.bg(t.raised))
    .hover((s) => s.bg(t.hover))
    .on_click(() => (view.listed.has(kid.address) ? run("agent.focus", { terminal: kid.address }) : view.peek(kid.address)))
    .children(sub.lines.map((line) => div().self_start().mt(-4).w(9).h(20).mr(4).flex_none()
      .when(Boolean(line), (el) => el.border_l(1.5).border_color(t.input))
      .when(line === "└" || line === "├", (el) => el.border_b(1.5).rounded_bl(6))))
    .child(div().mr(8).child(statusIcon(t, kid.address, status, selected, icon(kid.program, t.foreground), tintOf(t, pane?.cwd), view.redrawIn)))
    .child(div().flex_1().truncate().text_color(selected ? t.foreground : t.muted).tooltip(kid.name || kid.address)
      .child(own.text || kid.name || kid.template || kid.program?.name || kid.address))
    .when(Boolean(own.pr), (el) => el.child(div().mx(6).child(prChip(t, own.pr))));
}
