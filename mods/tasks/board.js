// The layout's "work-stack" shows either "work" (tab bar and terminals) or "board-page"
// (bar() + board()). Any navigation hides the board.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, shared, setShared, focused } from "herdr";
import { spacePill, statusIcon, icon, repoSpace, forget } from "./look.js";
import { solid, fadeText, tintOf, workingTitle, prLook, boardShown } from "./shared.js";
import {
  KINDS,
  RANK,
  openKindMenu,
  context,
  duration,
  statusOf,
  refreshPrs,
  childLabel,
  repoAlias,
  repoOf,
  bare,
} from "./work.js";
import { leadPanes, title } from "./titles.js";

export const showBoard = (on) => {
  if (on === boardShown()) return;
  // Saved now, because a hidden board doesn't see tab changes.
  if (on) setShared("task.boardFrom", focused()?.tab ?? null);
  run("layout.select", { stack: "work-stack", child: on ? "board-page" : "work" });
};
export const toggleBoard = () => showBoard(!boardShown());

export function agentCounts(allPanes = panes()) {
  const count = (status) => allPanes.filter((p) => p.status === status).length;
  return { blocked: count("blocked"), working: count("working") };
}

const waitingPrs = (prs, infos) => {
  const withTab = new Set(
    infos
      .flatMap((info) => [info.pr, ...(info.kidPrs ?? [])])
      .map((pr) => pr?.url)
      .filter(Boolean),
  );
  return prs.filter((pr) => !pr.merged && !withTab.has(pr.url));
};

export function summary() {
  const allPanes = panes();
  const { info, prs } = context(allPanes);
  const leads = leadPanes(allPanes);
  const tabs = spaces()
    .flatMap((s) => s.tabs)
    .filter((tab) => leads.has(tab.id));
  return {
    ...agentCounts(allPanes),
    total: tabs.length + waitingPrs(prs, [...info.values()]).length,
  };
}

// Async work from a click goes through that click's cx.
const openUrl = (cx, url) =>
  cx.spawn(async () => {
    await exec("open", [url]).catch(() => null);
  });

export function prChip(t, pr) {
  const { label, fill } = prLook(t, pr);
  return h_flex()
    .id(`pr-${pr.url}`)
    .flex_none()
    .h(20)
    .px(7)
    .rounded(5)
    .items_center()
    .bg(fill ? fill.bg + (pr.merged ? "e6" : "33") : t.raised)
    .text_size(11)
    .text_color(fill?.fg ?? t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(fill ? fill.bg + (pr.merged ? "ff" : "66") : t.hover))
    .tooltip(`${pr.title} (${label})`)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openUrl(cx, pr.url);
    })
    .child(`#${pr.number}`);
}

function header(t, view, id, label, color, count) {
  const open = !view.folded.has(id);
  return h_flex()
    .id(id)
    .px(10)
    .pt(14)
    .pb(4)
    .flex_none()
    .gap(6)
    .items_center()
    .text_size(11)
    .font_medium()
    .cursor_pointer()
    .on_click((_e, cx) => {
      if (open) view.folded.add(id);
      else view.folded.delete(id);
      cx.notify();
    })
    .child(div().text_color(color).child(label))
    .child(div().text_color(t.dim).child(String(count)))
    .child(div().flex_1())
    .when(!open, (el) =>
      el.child(
        svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim),
      ),
    );
}

// "│" passes by, "├" and "└" branch to the row.
const treeLines = (t, lines, top, height) =>
  lines.map((line) =>
    div()
      .self_start()
      .mt(top)
      .w(9)
      .h(height)
      .mr(5)
      .flex_none()
      .when(Boolean(line), (el) => el.border_l(1.5).border_color(t.input))
      .when(line === "└" || line === "├", (el) => el.border_b(1.5).rounded_bl(6)),
  );

export function board(view, t) {
  // With the terminals covered there may be no focused tab: that is not a move.
  const focusedTab = focused()?.tab,
    openedFrom = shared("task.boardFrom");
  if (focusedTab && openedFrom && focusedTab !== openedFrom && boardShown()) showBoard(false);

  const allPanes = panes(),
    allSpaces = spaces();
  const leads = leadPanes(allPanes);
  const { info, prs } = context(allPanes);
  const now = Date.now();
  const paneOf = new Map(allPanes.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const spaceOfTab = new Map(allSpaces.flatMap((s) => s.tabs.map((tab) => [tab.id, s])));
  const liveTerminals = terminals().filter((k) => k.state === "live");
  const terminalOf = new Map(liveTerminals.map((k) => [k.address, k]));
  // Each row shows its agent's own status, never its tab's.
  const statusAt = (address) => statusOf(paneOf.get(address), terminalOf.get(address));

  let tasks = allSpaces.flatMap((space) =>
    space.tabs
      .filter((tab) => leads.has(tab.id))
      .map((tab) => ({ space, tab, lead: leads.get(tab.id), ...info.get(tab.id) })),
  );
  const waiting = waitingPrs(prs, tasks);

  const kidTree = (address, indent = []) => {
    const kids = liveTerminals.filter((k) => k.parent === address);
    return kids.flatMap((kid, i) => {
      const last = i === kids.length - 1;
      return [
        { kid, lines: [...indent, last ? "└" : "├"] },
        ...kidTree(kid.address, [...indent, last ? "" : "│"]),
      ];
    });
  };
  const kidsOf = new Map(tasks.map((task) => [task.tab.id, kidTree(task.lead.terminal)]));
  // A tab led by a child that already shows under its parent gets no row of its own.
  const nested = new Set([...kidsOf.values()].flat().map((node) => node.kid.address));
  tasks = tasks.filter((task) => !nested.has(task.lead.terminal));

  const urgency = (task) =>
    Math.max(
      RANK[statusAt(task.lead.terminal)] ?? 0,
      ...kidsOf.get(task.tab.id).map((node) => RANK[statusAt(node.kid.address)] ?? 0),
    );
  tasks.sort(
    (x, y) => urgency(y) - urgency(x) || (y.tab.changed_at ?? 0) - (x.tab.changed_at ?? 0),
  );

  const kidRow = (task, { kid, lines }) => {
    const pane = paneOf.get(kid.address);
    const own = childLabel(kid.address, pane, prs);
    const status = statusAt(kid.address);
    const otherSpace =
      pane && spaceOfTab.get(pane.tab) !== task.space ? spaceOfTab.get(pane.tab)?.name : null;
    return h_flex()
      .id(`wk-${kid.address}`)
      .h(34)
      .pl(18)
      .pr(10)
      .gap(0)
      .flex_none()
      .rounded(8)
      .items_center()
      .cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .on_click(() => {
        run(pane ? "agent.focus" : "terminal.peek", { terminal: kid.address });
        showBoard(false);
      })
      .children(treeLines(t, lines, -2, 19))
      .child(
        div()
          .mr(8)
          .child(
            statusIcon(
              t,
              `w-${kid.address}`,
              status,
              false,
              icon(kid.program, t.foreground),
              tintOf(t, pane?.cwd, task.space.id),
              view.redrawIn,
            ),
          ),
      )
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(6)
          .items_center()
          .child(
            div()
              .min_w(0)
              .truncate()
              .text_size(12.5)
              .text_color(status === "idle" ? t.muted : t.foreground)
              .tooltip(kid.name || kid.address)
              .child(own.text || kid.name || kid.program?.name || kid.address),
          )
          .when(Boolean(otherSpace), (el) =>
            el.child(div().flex_none().text_size(12.5).text_color(t.dim).child(`· ${otherSpace}`)),
          ),
      )
      .when(Boolean(own.pr), (el) => el.child(div().ml(10).child(prChip(t, own.pr))));
  };

  const taskRow = (task) => {
    const { space, tab, lead, kind, pr, lastRun } = task;
    const status = statusAt(lead.terminal);
    const current = tab.active && space.active;
    const age =
      kind.id === "loop" && lastRun
        ? `ran ${duration(now - lastRun)} ago`
        : tab.changed_at
          ? duration(now - tab.changed_at)
          : "";
    const repo = repoOf(space.name, lead.cwd);
    const tint = tintOf(t, lead.cwd, space.id),
      text = title(tab, lead, task);
    // A painted fade needs the color the row really shows.
    const rowBg = solid(
      view.boardHovered === tab.id ? t.hover : current ? t.selected : t.background,
      t.background,
    );
    return h_flex()
      .id(`w-${tab.id}`)
      .h(34)
      .px(10)
      .gap(10)
      .flex_none()
      .rounded(8)
      .items_center()
      .cursor_pointer()
      .when(current, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .on_hover((over, cx) => {
        if (over) view.boardHovered = tab.id;
        else if (view.boardHovered === tab.id) view.boardHovered = null;
        cx.notify();
      })
      .on_click(() => {
        run("pane.focus", { pane: lead.pane });
        showBoard(false);
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openKindMenu(tab.id, { tabSpace: space.id });
      })
      .child(
        statusIcon(
          t,
          `w-${tab.id}`,
          status,
          current,
          icon(lead.program, t.foreground),
          tint,
          view.redrawIn,
        ),
      )
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(8)
          .items_center()
          .child(spacePill(t, repoSpace(allSpaces, repo, space.id), repoAlias(repo)))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .flex()
              .text_color(status === "idle" ? t.muted : t.foreground)
              .child(
                fadeText(
                  status === "working" ? workingTitle(`w-${tab.id}`, text, t, tint) : text,
                  rowBg,
                  `w-${tab.id}`,
                  view,
                ),
              ),
          ),
      )
      .when(Boolean(pr), (el) => el.child(prChip(t, pr)))
      .when(Boolean(age), (el) =>
        el.child(div().flex_none().text_size(11).text_color(t.dim).child(age)),
      );
  };

  const waitingRow = (pr) =>
    h_flex()
      .id(`wait-${pr.url}`)
      .h(34)
      .px(10)
      .gap(10)
      .flex_none()
      .rounded(8)
      .items_center()
      .cursor_pointer()
      .hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => openUrl(cx, pr.url))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(15).flex_none().text_color(t.dim))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(6)
          .items_center()
          .child(
            div()
              .flex_none()
              .text_color(t.dim)
              .child(`${repoAlias(pr.repo)} ·`),
          )
          .child(div().min_w(0).truncate().text_color(t.muted).child(bare(pr.title))),
      )
      .child(prChip(t, pr))
      .child(
        div()
          .flex_none()
          .text_size(11)
          .text_color(t.dim)
          .child(duration(now - pr.updated)),
      );

  const sections = [
    ...KINDS.map((kind) => {
      const ofKind = tasks.filter((task) => task.kind.id === kind.id);
      const rows = ofKind.flatMap((task) => [
        taskRow(task),
        ...kidsOf.get(task.tab.id).map((node) => kidRow(task, node)),
      ]);
      return {
        id: `k-${kind.id}`,
        label: kind.label,
        color: t[kind.color],
        count: ofKind.length,
        rows,
      };
    }),
    {
      id: "k-waiting",
      label: "Waiting on others",
      color: t.dim,
      count: waiting.length,
      rows: waiting.map(waitingRow),
    },
  ].filter((section) => section.rows.length);

  forget(
    view,
    new Set([...allSpaces.flatMap((s) => s.tabs.map((tab) => tab.id)), ...nested]),
    "w-",
  );
  return v_flex()
    .size_full()
    .min_h(0)
    .rounded(10)
    .bg(t.background)
    .text_size(13)
    .when(!sections.length, (el) =>
      el.child(
        div()
          .px(20)
          .pt(16)
          .text_size(12)
          .text_color(t.dim)
          .child("Nothing open. Tabs with a terminal and your open PRs show up here."),
      ),
    )
    .child(
      v_flex()
        .id("w-list")
        .flex_1()
        .min_h(0)
        .px(10)
        .pb(10)
        .overflow_y_scrollbar()
        .children(
          sections.flatMap((s) => [
            header(t, view, s.id, s.label, s.color, s.count),
            ...(view.folded.has(s.id) ? [] : s.rows),
          ]),
        ),
    );
}

export function bar(t) {
  const fetched = shared("task.prs") ?? {};
  const { total } = summary();
  return h_flex()
    .size_full()
    .min_w(0)
    .px(10)
    .gap(3)
    .items_center()
    .bg(t.chrome)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .h(29)
        .px(10)
        .gap(7)
        .rounded(7)
        .items_center()
        .flex_none()
        .text_size(12.8)
        .border(1)
        .border_color(t.border)
        .bg(t.raised)
        .text_color(t.foreground)
        .child(svg("mods/workspace-chrome/circle-check.svg").size(14).text_color(t.muted))
        .child("Work")
        .child(div().text_color(t.dim).child(String(total))),
    )
    .child(div().flex_1())
    .when(Boolean(fetched.error), (el) =>
      el.child(
        div()
          .min_w(0)
          .truncate()
          .px(8)
          .text_size(12)
          .text_color(t.blocked)
          .tooltip(fetched.error)
          .child("GitHub failed"),
      ),
    )
    .child(
      h_flex()
        .id("w-refresh")
        .h(26)
        .px(8)
        .gap(5)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .tooltip("Refresh PRs")
        .on_click((_e, cx) =>
          cx.spawn(async () => {
            await refreshPrs();
          }),
        )
        .child(svg("mods/workspace-chrome/git-branch.svg").size(14))
        .child(fetched.at ? `PRs ${duration(Date.now() - fetched.at)} ago` : "PRs…"),
    );
}
