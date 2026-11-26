// lasso's additions to the stock `agents` mod, called from one-line hooks in main.js (L.*).
// With props, this mod draws another page instead of the agents list (see page()).

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import {
  run,
  focused,
  props,
  closeOverlay,
  nextCommand,
  panes,
  spaces,
  terminals,
  knownAgents,
  shared,
  setShared,
} from "herdr";
import {
  repoOf,
  KINDS,
  AUTO,
  RANK,
  setKind,
  kindOf,
  kindItems,
  openKindMenu,
  context,
  statusOf,
  childLabel,
  spaceLabel,
} from "./work.js";
import { shortTitle } from "./titles.js";
import { spaceCard, statusIcon, statusMark, icon, repoSpace, forget } from "./look.js";
import {
  solid,
  fadeText,
  tintOf,
  workingTitle,
  keepConfFresh,
  repoAlias,
  boardShown,
  leadPanes,
  tourVeil,
  AGENT_ROW,
  spacesHidden,
  toggleSpaces,
} from "./lib/shared.js";
import { board, bar, showBoard, toggleBoard, summary, prChip } from "./board.js";
export { holdDone, heldRank } from "./work.js";
export { tourRow } from "./tour.js";
export { statusOf, statusMark, forget, tourVeil };

export const KIND_SORT = { id: "kind", label: "By kind", icon: "archive" };
// main.js returns statusMark() on this flag, so its stock status code stays in place.
export const OWN_STATUS = true;
export const kindGroup = (id, kind, agent) => ({
  id,
  label: kind.label,
  status: null,
  color: kind.color,
  members: [agent],
});

function cycleKind(tab) {
  const { kind, manual } = kindOf(tab, context().info);
  setKind(tab, manual ? (KINDS[KINDS.indexOf(kind) + 1]?.id ?? AUTO.id) : KINDS[0].id);
}

// Returns true for the pages. mods/lasso-data writes the shared data that every copy reads.
export function initWork(cx) {
  keepConfFresh(cx);
  const isPage = Boolean(props()?.board || props()?.nav || props()?.boardBar);
  if (isPage) cx.timer.every(30000, (cx) => cx.notify()); // the "5m ago" texts
  return isPage;
}

// Only the sidebar copy listens, so a shown board doesn't act twice.
export function listenKeys(cx, view) {
  // For the tour's sparkle: it finds a row in a scrolled list (tourRow).
  view.listScroll = ScrollHandle.new();
  cx.spawn(async () => {
    try {
      for (const agent of await knownAgents())
        if (agent.run?.[0]) agentCommands.add(agent.run[0].split("/").pop());
    } catch {}
  });
  cx.timer.every(2000, (cx) => {
    if (silentPanes().length) cx.notify();
  });
  cx.spawn(async () => {
    for (;;) {
      const command = await nextCommand();
      if (command === "cycle") cycleKind(focused()?.tab);
      if (command === "board") toggleBoard();
    }
  });
}

// An agent reports a status only once it has started. Before that it may sit on a screen that
// needs you (trust this folder, login, MCP approval), so a silent agent pane gets a row.
const SETUP_MS = 5000;
const firstSeen = new Map();
// Herdr opens an agent inside the login shell, so the pane's program is the shell at first.
const agentCommands = new Set(["claude"]);
const runsAgent = (argv) =>
  (argv ?? []).some((arg) => agentCommands.has(String(arg).split("/").pop()));
function silentPanes() {
  const silent = panes().filter((p) => p.terminal && !p.status);
  if (!silent.length) return silent;
  const argvOf = new Map(terminals().map((t) => [t.address, t.argv]));
  return silent.filter((p) => p.program?.agent || runsAgent(argvOf.get(p.terminal)));
}

export function withSetup(list) {
  const now = Date.now();
  const silent = silentPanes();
  for (const terminal of firstSeen.keys())
    if (!silent.some((p) => p.terminal === terminal)) firstSeen.delete(terminal);
  const rows = [];
  for (const pane of silent) {
    if (!firstSeen.has(pane.terminal)) firstSeen.set(pane.terminal, now);
    if (
      now - firstSeen.get(pane.terminal) < SETUP_MS ||
      list.some((a) => a.address === pane.terminal)
    )
      continue;
    const space = spaces().find((s) => s.tabs.some((tab) => tab.id === pane.tab));
    const tabIndex = space?.tabs.findIndex((tab) => tab.id === pane.tab) ?? -1;
    rows.push({
      address: pane.terminal,
      pane: pane.pane,
      space: space?.id ?? "",
      space_name: space?.name ?? "",
      tab: pane.tab,
      tab_index: tabIndex,
      tab_name: space?.tabs[tabIndex]?.name ?? "",
      status: "blocked",
      app: null,
      program: pane.program?.agent ? pane.program : { ...pane.program, name: "Agent" },
      title: pane.title,
      seq: 0,
      pinned: false,
      focused: pane.focused,
      setup: true,
    });
  }
  return rows.length ? [...list, ...rows] : list;
}

// Called first in every render. Null: draw the agents list.
export function page(view, t, narrow, cx) {
  view.redrawIn = (ms) => cx.timer.after(ms, (cx) => cx.notify());
  const pageProps = props() ?? {};
  if (pageProps.kindMenu) return kindMenu(view, t);
  if (pageProps.board) return board(view, t);
  if (pageProps.nav) return nav(t, narrow);
  if (pageProps.boardBar) return bar(t);
  return null;
}

// Built like Herdr's own menu (mods/menu). An entry with `cmd` runs that command instead of
// being picked. `view.at` is the keyboard row.
function pickMenu(view, t, entries, current, pick) {
  if (view.at == null)
    view.at = Math.max(
      0,
      entries.findIndex((entry) => entry.id === current),
    );
  const close = () => closeOverlay(props().overlay);
  const choose = (entry) => {
    close();
    if (entry.cmd) run(entry.cmd, entry.args);
    else pick(entry);
  };
  const row = (entry, i) =>
    h_flex()
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
      .child(
        entry.icon
          ? svg(`mods/workspace-chrome/${entry.icon}.svg`).size(14).flex_none().text_color(t.muted)
          : div()
              .size(8)
              .mx(3)
              .flex_none()
              .rounded(4)
              .bg(t[entry.dot] ?? t.dim),
      )
      .child(div().flex_1().child(entry.label))
      .when(entry.id === current, (el) =>
        el.child(
          svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground),
        ),
      );
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
    .children(
      entries.flatMap((entry, i) => (entry.sep ? [separator(), row(entry, i)] : [row(entry, i)])),
    );
}

function kindMenu(view, t) {
  const { kindMenu: tab, tabSpace, pin } = props();
  const { kind, manual } = kindOf(tab, context().info);
  return pickMenu(view, t, kindItems(tab, tabSpace, pin), manual ? kind.id : AUTO.id, (picked) =>
    setKind(tab, picked.id),
  );
}

// Its motion says how work is going. Painted paths ignore a parent's opacity, so the moving
// layers are plain fills.
const ROUNDED18 = () =>
  PathBuilder.fill()
    .move_to(5, 0)
    .line_to(13, 0)
    .arc_to(5, 5, 0, false, true, 18, 5)
    .line_to(18, 13)
    .arc_to(5, 5, 0, false, true, 13, 18)
    .line_to(5, 18)
    .arc_to(5, 5, 0, false, true, 0, 13)
    .line_to(0, 5)
    .arc_to(5, 5, 0, false, true, 5, 0)
    .close()
    .build();
const paint = (angle, from, to) =>
  globalThis.window
    .paint_path(ROUNDED18(), Background.linear_gradient(angle, from, to))
    .absolute()
    .top(0)
    .left(0)
    .size_full();
const wash = (id, color, to, period) =>
  div()
    .id(`wash-${id}`)
    .absolute()
    .top(0)
    .left(0)
    .size_full()
    .rounded(5)
    .bg(color)
    .loop("opacity", { from: 0, to, period });
const workTile = (mood) =>
  h_flex()
    .relative()
    .size(18)
    .flex_none()
    .items_center()
    .justify_center()
    .child(mood === "needs" ? paint(135, "#a855f7", "#f43f5e") : paint(135, "#8b5cf6", "#ec4899"))
    .when(mood === "busy", (el) =>
      el
        .child(wash("busy-pink", "#f472b6", 0.45, 4600))
        .child(wash("busy-indigo", "#818cf8", 0.3, 3100)),
    )
    .when(mood === "needs", (el) =>
      el
        .child(wash("needs-rose", "#fb7185", 0.5, 2400))
        .child(wash("needs-fuchsia", "#e879f9", 0.3, 1700)),
    )
    .child(paint(180, "#ffffff38", "#ffffff00"))
    .child(svg("mods/workspace-chrome/check.svg").size(11).text_color("#ffffff"));

function nav(t, narrow) {
  const shown = boardShown();
  const { total, blocked, working } = summary();
  const tile = workTile(blocked ? "needs" : working ? "busy" : "calm");
  const button = (el) =>
    el
      .id("work-nav")
      .h(32)
      .items_center()
      .rounded(8)
      .when(shown, (el) => el.bg(t.selected))
      .when(!shown, (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip("Work board (⌘K)")
      .on_click(() => toggleBoard());
  const frame = v_flex().size_full().bg(t.chrome).text_size(13).justify_center();
  // Last, so it lies over the button.
  const veil = tourVeil(t, "nav");
  if (narrow) {
    return frame
      .child(
        button(h_flex().mx(8).justify_center().gap(4))
          .child(tile)
          .when(blocked > 0, (el) => el.child(div().text_color(t.blocked).child("●"))),
      )
      .children(veil);
  }
  return frame
    .px(8)
    .child(
      button(h_flex().px(8).flex_none().gap(9))
        .child(tile)
        .child(div().flex_shrink(0).text_color(t.foreground).child("Work"))
        .child(
          h_flex()
            .flex_1()
            .min_w(0)
            .gap(5)
            .justify_end()
            .items_center()
            .text_size(11.5)
            .text_color(t.dim)
            .when(blocked > 0, (el) =>
              el.child(
                div()
                  .flex_none()
                  .text_color(t.blocked)
                  .child(`● ${blocked} need${blocked === 1 ? "s" : ""} you`),
              ),
            )
            .when(blocked === 0 && total > 0, (el) =>
              el.child(div().flex_none().child(String(total))),
            ),
        ),
    )
    .children(veil);
}

function focusPane(pane) {
  run("pane.focus", { pane });
  showBoard(false);
}

// Read once per render: each host read copies a whole list.
export function renderState(view, sort) {
  const paneList = panes();
  const { info, prs } = context(paneList);
  view.prs = prs;
  view.paneOf = new Map(paneList.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const cwdOf = (agent) => view.paneOf.get(agent.address)?.cwd;
  const kindAt = (tab) => kindOf(tab, info);
  const allSpaces = spaces();
  const hoverSpace = shared("space.hover") ?? null;
  return {
    info,
    paneList,
    allSpaces,
    kindAt,
    onBoard: boardShown(),
    hoverSpace,
    hovered: hoverSpace ? allSpaces.find((s) => s.id === hoverSpace) : null,
    byKind: sort.id === KIND_SORT.id,
    order: (x, y) => KINDS.indexOf(kindAt(x.tab).kind) - KINDS.indexOf(kindAt(y.tab).kind),
    repoName: (agent) => repoOf(agent.space_name, cwdOf(agent)),
    spaceName: (agent) => spaceLabel(agent.space_name, cwdOf(agent)),
  };
}

// Pinned agents first; "By kind" groups by kind. While the pointer is over the list, the order
// holds still, so nothing moves under the cursor. The window is asked for the pointer, since a
// popup can end a hover while the pointer stays.
export function holdStill(view, list, state, byPriority, rankOf) {
  const needsYou = (agent) => (rankOf(agent) === RANK.blocked ? 1 : 0);
  if (state.byKind)
    list = [...list].sort(
      (x, y) => state.order(x, y) || needsYou(y) - needsYou(x) || y.seq - x.seq,
    );
  list = [...list.filter((a) => a.pinned), ...list.filter((a) => !a.pinned)];

  const bounds = view.listBounds,
    pointer = bounds && globalThis.window.mouse_position();
  const holding = Boolean(
    pointer &&
    pointer.x >= bounds.x &&
    pointer.x <= bounds.x + bounds.width &&
    pointer.y >= bounds.y &&
    pointer.y <= bounds.y + bounds.height,
  );
  if (!holding || !view.frozen) {
    view.frozen = {
      order: list.map((a) => a.address),
      rank: new Map(list.map((a) => [a.address, rankOf(a)])),
    };
    return { list, rank: rankOf };
  }

  const LAST = 1e9;
  const place = new Map(view.frozen.order.map((address, i) => [address, i]));
  const spacePlace = new Map();
  for (const address of view.frozen.order) {
    const space = list.find((a) => a.address === address)?.space;
    if (space && !spacePlace.has(space)) spacePlace.set(space, spacePlace.size);
  }
  const rank = (agent) => view.frozen.rank.get(agent.address) ?? rankOf(agent);
  const byGroup = (x, y) =>
    byPriority
      ? rank(y) - rank(x)
      : state.byKind
        ? state.order(x, y)
        : (spacePlace.get(x.space) ?? LAST) - (spacePlace.get(y.space) ?? LAST);
  const byPlace = (x, y) => (place.get(x.address) ?? LAST) - (place.get(y.address) ?? LAST);
  list = [...list].sort(
    (x, y) =>
      Number(y.pinned) - Number(x.pinned) || (x.pinned ? 0 : byGroup(x, y)) || byPlace(x, y),
  );
  return { list, rank };
}

export const watchList = (view, el) =>
  el
    .track_scroll(view.listScroll)
    .on_mouse_move((e) => {
      view.listBounds = e.bounds;
    })
    .on_hover((over, cx) => {
      if (!over) cx.timer.after(120, (cx) => cx.notify());
    });

const publish = (key, value) => {
  if (JSON.stringify(value) !== JSON.stringify(shared(key) ?? {})) setShared(key, value);
};

// Also publishes the short titles for the tab bar and pane headers (tasks-tabs, tasks-pane).
export function labels(view, state, list, tabCounts, allTerminals, into) {
  const leads = leadPanes(state.paneList);
  const tabs = spaces().flatMap((s) => s.tabs);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const tabLabels = new Map(
    tabs.map((tab) => [tab.id, shortTitle(tab, leads.get(tab.id), state.info.get(tab.id))]),
  );
  publish("task.short", Object.fromEntries([...tabLabels].filter(([id]) => leads.has(id))));
  const liveKids = allTerminals.filter((k) => k.parent && k.state === "live");
  publish(
    "task.child",
    Object.fromEntries(
      liveKids.map((k) => [
        k.address,
        childLabel(k.address, view.paneOf.get(k.address), view.prs).text || k.name || "",
      ]),
    ),
  );

  // A tab's name and summary are about its lead agent, so others in the tab show their own.
  const ownTitle = (agent) =>
    shortTitle(
      { ...tabById.get(agent.tab), named: false },
      view.paneOf.get(agent.address) ?? agent,
      { branch: state.info.get(agent.tab)?.branch },
    );
  for (const agent of list) {
    const sharesTab = tabCounts.get(agent.tab) > 1 && tabById.has(agent.tab);
    const label = agent.setup
      ? "waiting on setup"
      : sharesTab
        ? ownTitle(agent)
        : (tabLabels.get(agent.tab) ?? (agent.title || agent.program?.name || ""));
    into.set(agent.address, label);
  }
}

function railRow(view, agent, t, pic, tip, onBoard, tint) {
  return h_flex()
    .id(`ag-${agent.address}`)
    .h(AGENT_ROW)
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

// The last argument is what the stock row worked out.
export function row(
  view,
  t,
  agent,
  subs,
  { more, machine, collapsed, byPriority, state, label, fold },
) {
  const pic = icon(agent.program, t.foreground);
  const tint = tintOf(t, view.paneOf.get(agent.address)?.cwd, agent.space);
  const spaceName = state.spaceName(agent) || label(agent);
  if (collapsed) return railRow(view, agent, t, pic, spaceName, state.onBoard, tint);
  const selected = agent.focused && !state.onBoard;

  // Without a space header above it (priority, by kind, pinned), the row names its space.
  const noHeader = byPriority || state.byKind || agent.pinned;
  const repo = state.repoName(agent);
  const card =
    noHeader && more
      ? spaceCard(t, repoSpace(state.allSpaces, repo, agent.space), repo, repoAlias(repo))
      : null;
  const ownLabel = /^\d+$/.test(label(agent)) ? agent.program?.name || label(agent) : label(agent);
  const text = card ? more : noHeader ? spaceName : (more ?? ownLabel);

  // A repo's space keeps all its agents lit, in any worktree.
  const dimmed =
    Boolean(state.hovered) &&
    agent.space !== state.hoverSpace &&
    repoSpace(state.allSpaces, repo) !== state.hoverSpace;
  // A painted fade can't be dimmed, so the fade needs the color the row really shows.
  let rowBg = view.hovered === agent.address ? solid(t.hover, t.chrome) : solid(t.chrome, t.chrome);
  const working = agent.status === "working";
  if (selected) rowBg = solid(t.selected, rowBg);
  if (dimmed) rowBg = solid(rowBg + "59", t.chrome);

  const pr = state.kindAt(agent.tab).pr;
  const idle = agent.status === "idle" && !agent.focused;
  const toggleFold = (_e, cx) => {
    cx.stop_propagation();
    if (view.folded.has(agent.address)) view.folded.delete(agent.address);
    else view.folded.add(agent.address);
    cx.notify();
  };
  return h_flex()
    .id(`ag-${agent.address}`)
    .relative()
    .opacity(dimmed ? 0.35 : 1)
    .transition("opacity", 160)
    .px(8)
    .h(AGENT_ROW)
    .flex_none()
    .rounded(8)
    .items_center()
    .gap(9)
    .child(
      div()
        .id(`ag-sel-${agent.address}`)
        .absolute()
        .top(0)
        .left(0)
        .size_full()
        .rounded(8)
        .bg(t.selected)
        .opacity(selected ? 1 : 0)
        .transition("opacity", 180),
    )
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
    .child(
      div()
        .id(`agent-fold-${agent.address}`)
        .when(subs.length > 0, (el) => el.on_click(toggleFold))
        .child(statusIcon(t, agent.address, agent.status, agent.focused, pic, tint, view.redrawIn)),
    )
    .child(
      div()
        .id(`ag-title-${agent.address}`)
        .flex_1()
        .min_w(0)
        .flex()
        .items_center()
        .gap(7)
        .text_color(idle ? t.muted : t.foreground)
        .when(Boolean(card), (el) => el.child(card))
        .child(
          fadeText(
            working ? workingTitle(agent.address, text, t, tint) : text,
            rowBg,
            `ag-${agent.address}`,
            view,
          ),
        ),
    )
    .when(Boolean(machine), (el) =>
      el.child(div().flex_none().text_size(10).text_color(t.dim).child(machine)),
    )
    .when(subs.length > 0, (el) => el.child(fold(agent, subs)))
    .when(Boolean(pr), (el) => el.child(prChip(t, pr)));
}

// `sub` is the stock { t: terminal, lines: tree lines }.
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
    .h(AGENT_ROW)
    .flex_none()
    .gap(0)
    .items_center()
    .text_size(12.5)
    .when(selected, (el) => el.bg(t.raised))
    .hover((s) => s.bg(t.hover))
    .on_click(() =>
      view.listed.has(kid.address)
        ? run("agent.focus", { terminal: kid.address })
        : view.peek(kid.address),
    )
    .children(
      sub.lines.map((line) =>
        div()
          .self_start()
          .mt(-4)
          .w(9)
          .h(20)
          .mr(4)
          .flex_none()
          .when(Boolean(line), (el) => el.border_l(1.5).border_color(t.input))
          .when(line === "└" || line === "├", (el) => el.border_b(1.5).rounded_bl(6)),
      ),
    )
    .child(
      div()
        .mr(8)
        .child(
          statusIcon(
            t,
            kid.address,
            status,
            selected,
            icon(kid.program, t.foreground),
            tintOf(t, pane?.cwd),
            view.redrawIn,
          ),
        ),
    )
    .child(
      div()
        .flex_1()
        .truncate()
        .text_color(selected ? t.foreground : t.muted)
        .tooltip(kid.name || kid.address)
        .child(own.text || kid.name || kid.template || kid.program?.name || kid.address),
    )
    .when(Boolean(own.pr), (el) => el.child(div().mx(6).child(prChip(t, own.pr))));
}

// Fills the Agents header up to the sort icon. While the Spaces list is folded (its header's
// chevron), "Spaces ›" here unfolds it, as a folded group's header shows its chevron.
export const showSpaces = (t) =>
  h_flex()
    .flex_1()
    .pr(10)
    .justify_end()
    .when(spacesHidden(), (el) =>
      el.child(
        h_flex()
          .id("spaces-show")
          .h(18)
          .px(4)
          .gap(4)
          .items_center()
          .rounded(4)
          .text_size(11)
          .text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip("Show spaces (⌘⇧B)")
          .on_click(() => toggleSpaces())
          .child("Spaces")
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11)),
      ),
    );
