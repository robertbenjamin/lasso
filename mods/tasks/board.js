// The Work board: every tab with a terminal under Recurring / Ship / Side, most urgent first,
// then your open PRs with no tab.
// It is a page: the layout's "work-stack" shows either "work" (tab bar and terminals) or
// "board-page" (bar() + board()). The sidebar's Work row and the key tasks.board toggle it,
// and any navigation hides it.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, shared, setShared, layout, focused } from "herdr";
import { spacePill, statusIcon, icon, repoSpace, forget } from "./look.js";
import { solid, fadeText, tintOf, workingTitle, find, pastelFill, CI, REVIEW } from "./shared.js";
import { KINDS, RANK, openKindMenu, context, duration, statusOf, refreshPrs, childLabel, repoAlias, repoOf, bare, prChipDemo } from "./work.js";
import { leadPanes, title } from "./titles.js";

export const boardShown = () => find(layout(), "work-stack")?.active === "board-page";
export const showBoard = (on) => {
  if (on === boardShown()) return;
  // The tab you were on: going to another tab hides the board (board()). Saved now, because
  // a hidden board doesn't see tab changes.
  if (on) setShared("task.boardFrom", focused()?.tab ?? null);
  run("layout.select", { stack: "work-stack", child: on ? "board-page" : "work" });
};
export const toggleBoard = () => showBoard(!boardShown());

// How many agents need you and how many work.
export function agentCounts(allPanes = panes()) {
  const count = (status) => allPanes.filter((p) => p.status === status).length;
  return { blocked: count("blocked"), working: count("working") };
}

// Your open PRs that no tab works on.
const waitingPrs = (prs, infos) => {
  const withTab = new Set(infos.flatMap((info) => [info.pr, ...(info.kidPrs ?? [])]).map((pr) => pr?.url).filter(Boolean));
  return prs.filter((pr) => !pr.merged && !withTab.has(pr.url));
};

// For the Work row and the bar: the agent counts, and how many things are on the board.
export function summary() {
  const allPanes = panes();
  const { info, prs } = context(allPanes);
  const leads = leadPanes(allPanes);
  const tabs = spaces().flatMap((s) => s.tabs).filter((tab) => leads.has(tab.id));
  return { ...agentCounts(allPanes), total: tabs.length + waitingPrs(prs, [...info.values()]).length };
}

// Async work from a click goes through that click's cx.
const openUrl = (cx, url) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

// "#355" in its review state's color on a light tint of that color, with a CI dot while CI
// runs or after it fails. The tooltip has the title and state; a click opens the PR.
export function prChip(t, pr) {
  const state = pr.merged ? "merged" : pr.draft ? "draft" : REVIEW[pr.review] ?? "open";
  // A draft and a PR that needs no review ask for nothing: they stay gray.
  // Merged: the space pills' violet, because the theme's own ansi5 reads as gray-blue.
  const hue = { merged: pastelFill(t, "ansi5").fg, approved: t.ansi2, changes: t.working, "in review": t.ansi4 }[state];
  const showCi = pr.ci && pr.ci !== "SUCCESS" && !pr.merged;
  return h_flex()
    .id(`pr-${pr.url}`)
    .flex_none()
    .h(20)
    .px(7)
    .gap(6)
    .rounded(5)
    .items_center()
    .bg(hue ? hue + "40" : t.raised)
    .text_size(11)
    .text_color(hue ?? (pr.draft ? t.dim : t.muted))
    .cursor_pointer()
    .hover((s) => s.bg(hue ? hue + "59" : t.hover))
    .tooltip(`${pr.title} (${state})`)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openUrl(cx, pr.url);
    })
    .when(showCi, (el) => el.child(div().size(7).rounded(4).flex_none().bg(t[CI[pr.ci]] ?? t.dim)))
    .child(`#${pr.number}`);
}

// Every look of the PR chip, as fake rows on the board ("prChipDemo": true in lasso.json).
const DEMO = [["merged", { merged: true }], ["approved", { review: "APPROVED" }], ["changes requested", { review: "CHANGES_REQUESTED" }],
  ["in review", { review: "REVIEW_REQUIRED" }], ["open, no review needed", {}], ["draft", { draft: true }]];
const demoRows = (t) => DEMO.map(([label, pr], i) => h_flex().h(34).px(10).gap(10).flex_none().items_center()
  .child(div().flex_1().text_color(t.muted).child(label))
  .children((pr.merged ? [null] : [null, "PENDING", "FAILURE"]).map((ci, j) =>
    prChip(t, { ...pr, ci, number: 100 + i * 3 + j, title: `Fake PR, CI ${ci ?? "passed"}`, url: `https://github.com/demo/demo/pull/${100 + i * 3 + j}` }))));

// A section's header. A click folds the section.
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
      open ? view.folded.add(id) : view.folded.delete(id);
      cx.notify();
    })
    .child(div().text_color(color).child(label))
    .child(div().text_color(t.dim).child(String(count)))
    .child(div().flex_1())
    .when(!open, (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
}

// The tree lines before a child row: "│" passes by, "├" and "└" branch to the row.
const treeLines = (t, lines, top, height) => lines.map((line) => div().self_start().mt(top).w(9).h(height).mr(5).flex_none()
  .when(Boolean(line), (el) => el.border_l(1.5).border_color(t.input))
  .when(line === "└" || line === "├", (el) => el.border_b(1.5).rounded_bl(6)));

export function board(view, t) {
  // Going to another tab puts the terminals back. With the terminals covered there may be no
  // focused tab: that is not a move.
  const focusedTab = focused()?.tab, openedFrom = shared("task.boardFrom");
  if (focusedTab && openedFrom && focusedTab !== openedFrom && boardShown()) showBoard(false);

  const allPanes = panes(), allSpaces = spaces();
  const leads = leadPanes(allPanes);
  const { info, prs } = context(allPanes);
  const now = Date.now();
  const paneOf = new Map(allPanes.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const spaceOfTab = new Map(allSpaces.flatMap((s) => s.tabs.map((tab) => [tab.id, s])));
  const liveTerminals = terminals().filter((k) => k.state === "live");
  const terminalOf = new Map(liveTerminals.map((k) => [k.address, k]));
  // Each row shows its agent's own status, never its tab's (the most urgent of its agents).
  const statusAt = (address) => statusOf(paneOf.get(address), terminalOf.get(address));

  // A task: a tab with a terminal, its space, lead pane and context().info fields.
  let tasks = allSpaces.flatMap((space) => space.tabs.filter((tab) => leads.has(tab.id))
    .map((tab) => ({ space, tab, lead: leads.get(tab.id), ...info.get(tab.id) })));
  const waiting = waitingPrs(prs, tasks);

  // Child agents go under their parent's row, depth first, as in the sidebar: [{ kid, lines }].
  const kidTree = (address, indent = []) => {
    const kids = liveTerminals.filter((k) => k.parent === address);
    return kids.flatMap((kid, i) => {
      const last = i === kids.length - 1;
      return [{ kid, lines: [...indent, last ? "└" : "├"] }, ...kidTree(kid.address, [...indent, last ? "" : "│"])];
    });
  };
  const kidsOf = new Map(tasks.map((task) => [task.tab.id, kidTree(task.lead.terminal)]));
  // A tab led by a child that already shows under its parent gets no row of its own.
  const nested = new Set([...kidsOf.values()].flat().map((node) => node.kid.address));
  tasks = tasks.filter((task) => !nested.has(task.lead.terminal));

  // The most urgent of the lead and its children first, then the latest change.
  const urgency = (task) => Math.max(RANK[statusAt(task.lead.terminal)] ?? 0, ...kidsOf.get(task.tab.id).map((node) => RANK[statusAt(node.kid.address)] ?? 0));
  tasks.sort((x, y) => urgency(y) - urgency(x) || (y.tab.changed_at ?? 0) - (x.tab.changed_at ?? 0));

  const kidRow = (task, { kid, lines }) => {
    const pane = paneOf.get(kid.address);
    const own = childLabel(kid.address, pane, prs);
    const status = statusAt(kid.address);
    const otherSpace = pane && spaceOfTab.get(pane.tab) !== task.space ? spaceOfTab.get(pane.tab)?.name : null;
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
      .child(div().mr(8).child(statusIcon(t, `w-${kid.address}`, status, false, icon(kid.program, t.foreground), tintOf(t, pane?.cwd, task.space.id), view.redrawIn)))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().text_size(12.5).text_color(status === "idle" ? t.muted : t.foreground).tooltip(kid.name || kid.address)
          .child(own.text || kid.name || kid.program?.name || kid.address))
        .when(Boolean(otherSpace), (el) => el.child(div().flex_none().text_size(12.5).text_color(t.dim).child(`· ${otherSpace}`))))
      .when(Boolean(own.pr), (el) => el.child(div().ml(10).child(prChip(t, own.pr))));
  };

  const taskRow = (task) => {
    const { space, tab, lead, kind, pr, lastRun } = task;
    const status = statusAt(lead.terminal);
    const current = tab.active && space.active;
    const age = kind.id === "loop" && lastRun ? `ran ${duration(now - lastRun)} ago` : tab.changed_at ? duration(now - tab.changed_at) : "";
    const repo = repoOf(space.name, lead.cwd);
    const tint = tintOf(t, lead.cwd, space.id), text = title(tab, lead, task);
    // The color the row really shows, for the title's fade.
    const rowBg = solid(view.boardHovered === tab.id ? t.hover : current ? t.selected : t.background, t.background);
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
      .child(statusIcon(t, `w-${tab.id}`, status, current, icon(lead.program, t.foreground), tint, view.redrawIn))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center()
        .child(spacePill(t, repoSpace(allSpaces, repo, space.id), repoAlias(repo)))
        .child(div().flex_1().min_w(0).flex().text_color(status === "idle" ? t.muted : t.foreground)
          .child(fadeText(status === "working" ? workingTitle(`w-${tab.id}`, text, t, tint) : text, rowBg, `w-${tab.id}`, view))))
      .when(Boolean(pr), (el) => el.child(prChip(t, pr)))
      .when(Boolean(age), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(age)));
  };

  const waitingRow = (pr) => h_flex()
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
    .child(h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(div().flex_none().text_color(t.dim).child(`${repoAlias(pr.repo)} ·`))
      .child(div().min_w(0).truncate().text_color(t.muted).child(bare(pr.title))))
    .child(prChip(t, pr))
    .child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - pr.updated)));

  const sections = [
    ...KINDS.map((kind) => {
      const ofKind = tasks.filter((task) => task.kind.id === kind.id);
      const rows = ofKind.flatMap((task) => [taskRow(task), ...kidsOf.get(task.tab.id).map((node) => kidRow(task, node))]);
      return { id: `k-${kind.id}`, label: kind.label, color: t[kind.color], count: ofKind.length, rows };
    }),
    { id: "k-waiting", label: "Waiting on others", color: t.dim, count: waiting.length, rows: waiting.map(waitingRow) },
    { id: "k-demo", label: "PR chip demo", color: t.dim, count: DEMO.length, rows: prChipDemo() ? demoRows(t) : [] },
  ].filter((section) => section.rows.length);

  forget(view, new Set([...allSpaces.flatMap((s) => s.tabs.map((tab) => tab.id)), ...nested]), "w-");
  return v_flex()
    .size_full()
    .min_h(0)
    .rounded(10)
    .bg(t.background)
    .text_size(13)
    .when(!sections.length, (el) => el.child(div().px(20).pt(16).text_size(12).text_color(t.dim).child("Nothing open. Tabs with a terminal and your open PRs show up here.")))
    .child(v_flex()
      .id("w-list")
      .flex_1()
      .min_h(0)
      .px(10)
      .pb(10)
      .overflow_y_scrollbar()
      .children(sections.flatMap((s) => [header(t, view, s.id, s.label, s.color, s.count), ...(view.folded.has(s.id) ? [] : s.rows)])));
}

// The board page's top bar, in the tab bar's place and style: one "tab" that names the page,
// and the PR refresh where the panel buttons are.
export function bar(t) {
  const fetched = shared("task.prs") ?? {};
  const { total } = summary();
  return h_flex().size_full().min_w(0).px(10).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(h_flex().h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(t.border).bg(t.raised).text_color(t.foreground)
      .child(svg("mods/workspace-chrome/circle-check.svg").size(14).text_color(t.muted))
      .child("Work")
      .child(div().text_color(t.dim).child(String(total))))
    .child(div().flex_1())
    .when(Boolean(fetched.error), (el) => el.child(div().min_w(0).truncate().px(8).text_size(12).text_color(t.blocked).tooltip(fetched.error).child("GitHub failed")))
    .child(h_flex().id("w-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .tooltip("Refresh PRs")
      .on_click((_e, cx) => cx.spawn(async () => { await refreshPrs(0); }))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(14))
      .child(fetched.at ? `PRs ${duration(Date.now() - fetched.at)} ago` : "PRs…"));
}
