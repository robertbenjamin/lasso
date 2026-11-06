// Agents in grouped, priority or kind views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.
// Clone of the shipped `agents` mod. Each tab has a kind (ship / loop / side), automatic
// or set by you (work.js). Click a row's tag, right-click a row, or press `tasks.cycle`
// to set it. With props { board: true } this mod is the Work board instead (board.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout, nextCommand } from "herdr";
import { KINDS, AUTO, RANK, setKind, context, trackRuns, refreshPrs, refreshTitles, cleanWorktrees, loadAliases, duration, icon, statusMark, leadPanes, shortTitle, find, childLabel, spaceLabel } from "./work.js";
import { board, bar, boardShown, showBoard, toggleBoard, summary, prChip } from "./board.js";

const kindOf = (tab) => context().info.get(tab) ?? { kind: KINDS[2], manual: false };
// Auto → ship → loop → side → auto.
function cycleKind(tab) {
  const { kind, manual } = kindOf(tab);
  setKind(tab, manual ? KINDS[KINDS.indexOf(kind) + 1]?.id ?? AUTO.id : KINDS[0].id);
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
  { id: "kind", label: "By kind", icon: "archive" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu || props()?.kindMenu) return;
    this.folded = new Set();
    // Sidebar and board both keep the data fresh; the work is idempotent or leased (work.js).
    trackRuns();
    cx.timer.every(5000, () => trackRuns());
    // PRs first: a tab with a PR uses its title, and titles are the slow part.
    const refresh = async () => { await loadAliases(); await refreshPrs(); await refreshTitles(); await cleanWorktrees(); };
    cx.spawn(refresh);
    cx.timer.every(60000, (cx) => cx.spawn(refresh));
    if (props()?.board || props()?.nav || props()?.boardBar) {
      cx.timer.every(30000, (cx) => cx.notify());
      return;
    }
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    cx.timer.every(30000, (cx) => cx.notify());
    // Keys: `tasks.cycle` sets the focused tab's kind, `tasks.board` opens the Work board.
    // Only the sidebar copy listens, so a shown board doesn't act twice.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "cycle") cycleKind(focused()?.tab);
        if (c === "board") toggleBoard();
      }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    return this.pickMenu(t, "Sort agents", SORTS, sortOf().id, (s) => setShared("agents.sort", s.id));
  }

  // From the tab bar (props.tabSpace) it also keeps the shipped tab menu's items.
  kindMenu(t) {
    const { kindMenu: tab, tabSpace } = props();
    const { kind, manual } = kindOf(tab);
    const items = [...KINDS, { ...AUTO, label: `Auto (${kind.label.toLowerCase()} now)` }].map((k) => ({ ...k, dot: k.color }));
    if (manual) items[3].label = "Auto";
    if (tabSpace) items.push(
      { id: "rename", label: "Rename", icon: "square-pen", sep: true, cmd: "tab.rename", args: { id: tab } },
      { id: "new", label: "New tab", icon: "plus", cmd: "tab.new", args: { space: tabSpace } },
      { id: "close", label: "Close", icon: "x", cmd: "tab.close", args: { id: tab } },
    );
    return this.pickMenu(t, "Kind", items, manual ? kind.id : AUTO.id, (k) => setKind(tab, k.id));
  }

  // A popup list with a check on the current entry. Entries have an svg `icon` or a colored `dot`;
  // an entry with `cmd` runs that command instead of being picked.
  pickMenu(t, title, entries, on, pick) {
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child(title))
      .children(entries.flatMap((s) => [...(s.sep ? [div().mx(7).my(4).h(1).bg(t.border)] : []), h_flex()
        .id(`pick-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          closeOverlay(props().overlay);
          s.cmd ? run(s.cmd, s.args) : pick(s);
        })
        .child(s.icon
          ? svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted)
          : div().size(8).mx(3).flex_none().rounded(4).bg(t[s.dot] ?? t.dim))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))]));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    const own = childLabel(k.address, this.paneOf?.get(k.address), this.prs ?? []);
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
      .on_click(() => (this.listed.has(k.address) ? run("agent.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(20).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).tooltip(k.name || k.address).child(own.text || k.name || k.template || k.program?.name || k.address))
      .when(Boolean(own.pr), (el) => el.child(div().mx(6).child(prChip(t, own.pr))))
      .child(this.status(t, { status: st }, compact));
  }

  status(t, a, compact = false) {
    return statusMark(t, a.status, compact);
  }

  // The Work row at the top of the sidebar. Same measures as a space row in the shipped
  // `spaces` mod (30px, 13px text, 18px filled tile, 11.5px dim tail). Click: board on/off.
  nav(t) {
    const on = boardShown();
    const { total, blocked } = summary();
    if (narrow()) {
      // The rail: like the spaces mod's compact rows.
      return v_flex().size_full().bg(t.chrome).text_size(13).justify_center().child(h_flex()
        .id("work-nav")
        .h(26)
        .justify_center()
        .gap(4)
        .when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_click(() => toggleBoard())
        .child(svg("mods/workspace-chrome/circle-check.svg").size(14).text_color(on ? t.foreground : t.muted))
        .when(blocked > 0, (el) => el.child(div().text_color(t.blocked).child("●"))));
    }
    return v_flex().size_full().bg(t.chrome).text_size(13).px(8).justify_center().child(h_flex()
      .id("work-nav")
      .px(8)
      .h(32)
      .flex_none()
      .gap(9)
      .rounded(8)
      .items_center()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip("Work board (⌘K)")
      .on_click(() => toggleBoard())
      .child(h_flex().size(18).flex_none().rounded(5).bg(t.solid).items_center().justify_center()
        .child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.solid_foreground)))
      .child(div().flex_shrink(0).text_color(t.foreground).child("Work"))
      .child(h_flex().flex_1().min_w(0).gap(5).justify_end().items_center().text_size(11.5).text_color(t.dim)
        .when(blocked > 0, (el) => el.child(div().flex_none().text_color(t.blocked).child(`● ${blocked} need${blocked === 1 ? "s" : ""} you`)))
        .when(blocked === 0 && total > 0, (el) => el.child(div().flex_none().child(String(total))))));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.kindMenu) return this.kindMenu(t);
    if (props()?.board) return board(this, t);
    if (props()?.nav) return this.nav(t);
    if (props()?.boardBar) return bar(t);
    const collapsed = narrow();
    // On the board, nothing in the agents list is the current place.
    const onBoard = boardShown();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    // A sub-agent with a pane is in agents() too: show it only under its listed parent
    // (still flat when the rail is narrow and draws no tree, or when it is pinned).
    const parentOf = new Map(all.map((k) => [k.address, k.parent]));
    const nested = new Set(collapsed ? [] : list.filter((a) => !a.pinned && this.listed.has(parentOf.get(a.address))).map((a) => a.address));
    list = list.filter((a) => !nested.has(a.address));
    const byPriority = sort.id === "priority";
    const byKind = sort.id === "kind";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    const byUrgency = (x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq;
    if (byPriority) list = [...list].sort(byUrgency);
    // Read panes once: every host read copies the whole list into JS.
    const paneList = panes();
    const ctx = context(paneList);
    const kinds = ctx.info;
    // For the nested rows (subRow) and the child labels published below.
    this.prs = ctx.prs;
    this.paneOf = new Map(paneList.filter((p) => p.terminal).map((p) => [p.terminal, p]));
    const kindAt = (tab) => kinds.get(tab) ?? { kind: KINDS[2], manual: false };
    if (byKind) list = [...list].sort((x, y) => KINDS.indexOf(kindAt(x.tab).kind) - KINDS.indexOf(kindAt(y.tab).kind) || byUrgency(x, y));
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.flatMap((a) => [a.address, ...this.tree(all, a.address).map((s) => s.t.address).filter((x) => nested.has(x))]));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const leads = leadPanes(paneList);
    const spaceName = (a) => spaceLabel(a.space_name, this.paneOf.get(a.address)?.cwd);
    const tabLabels = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, shortTitle(tab, leads.get(tab.id), kinds.get(tab.id))]));
    // Publish the short titles of tabs with a terminal for the tab bar and pane headers
    // (tasks-tabs, tasks-pane): mods can't import each other's files. Written only on a change.
    const shorts = Object.fromEntries([...tabLabels].filter(([id]) => leads.has(id)));
    if (JSON.stringify(shorts) !== JSON.stringify(shared("task.short") ?? {})) setShared("task.short", shorts);
    // The same for child agents, by terminal (tasks-pane): "" means no label yet.
    const kidLabels = Object.fromEntries(all.filter((k) => k.parent && k.state === "live").map((k) => [k.address, childLabel(k.address, this.paneOf.get(k.address), this.prs).text || k.name || ""]));
    if (JSON.stringify(kidLabels) !== JSON.stringify(shared("task.child") ?? {})) setShared("task.child", kidLabels);
    const labels = new Map(list.map(a => [a.address, tabLabels.get(a.tab) ?? (a.title || a.program?.name || "")]));
    const label = (a) => labels.get(a.address);
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${spaceName(a)}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${spaceName(a)}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => {
          run("pane.focus", { pane: a.pane });
          showBoard(false);
        })
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || byKind || isPinned;
      // Auto kinds are dim text; a kind you set is a filled tag.
      const { kind, manual, pr } = kindAt(a.tab);
      const tag = div()
        .id(`kind-${a.address}`)
        .flex_none()
        .px(5)
        .h(16)
        .rounded(4)
        .flex()
        .items_center()
        .text_size(10)
        .text_color(manual ? t[kind.color] ?? t.dim : t.dim)
        .when(manual, (el) => el.bg((t[kind.color] ?? t.dim) + "22"))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(manual ? "Kind set by you. Click to cycle, right-click for the menu." : "Auto kind. Click to set it.")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          cycleKind(a.tab);
        })
        .child(kind.id);
      const name = full ? spaceName(a) || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .h(32)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(9)
        .when(a.focused && !onBoard, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => {
          run("pane.focus", { pane: a.pane });
          showBoard(false);
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "tasks", kind: "popup", width: 180, height: 204, at: "pointer", props: { kindMenu: a.tab } });
        })
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          // The repo is never cut (repo_aliases make it short); only the title after it is.
          .child(full && spaceName(a)
            ? div().flex_none().text_color(idle ? t.muted : t.foreground).child(name)
            : div().min_w(0).max_w(200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().text_size(10).text_color(t.dim).child(machine)))
        // In the kind view the header already says the kind; only "+" to tag shows there.
        .when(!byKind, el => el.child(tag))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(Boolean(pr), el => el.child(prChip(t, pr)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const k = kindAt(a.tab).kind;
      const id = byPriority ? `sec-${r}` : byKind ? `kind-${k.id}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else if (byKind) groups.push({ id, label: k.label, status: null, color: k.color, members: [a] });
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(12)
        .h(34)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t[g.color] ?? t.dim).child(g.label))
        .when(byPriority || byKind || !open, (el) => el.child(div().text_color(t.dim).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "tasks", kind: "popup", width: 200, height: 172, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
