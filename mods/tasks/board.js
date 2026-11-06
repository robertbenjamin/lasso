// The Work board: every tab with a terminal, sorted into Ship / Recurring / Side
// (auto, or your manual kind), most urgent first; then your open PRs with no tab.
// It is a page of its own: the layout's "work-stack" shows either "work" (tab bar,
// terminals, status bar) or "board-page" (this bar + the board). The sidebar's Work row
// (props { nav: true }) and the key tasks.board show and hide it. Any navigation hides it:
// a click on a board row, an agent row or a space (tasks-spaces), or a focus change.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, run, exec, openOverlay, shared, setShared, layout, focused } from "herdr";
import { KINDS, RANK, context, duration, icon, statusMark, leadPanes, title, bare, refreshPrs, find, childLabel, spaceLabel, repoAlias } from "./work.js";

export const boardShown = () => find(layout(), "work-stack")?.active === "board-page";
export const showBoard = (on) => {
  if (on === boardShown()) return;
  // The tab you were on when the board opened: going to another tab hides the board (board()).
  // Saved here, at the moment of opening, because a hidden board doesn't see tab changes.
  if (on) setShared("task.boardFrom", focused()?.tab ?? null);
  run("layout.select", { stack: "work-stack", child: on ? "board-page" : "work" });
};
export const toggleBoard = () => showBoard(!boardShown());

// For the sidebar row: how many things are on the board, and how many need you.
export function summary() {
  const leads = leadPanes(panes());
  const tabs = spaces().flatMap((s) => s.tabs).filter((tab) => leads.has(tab.id));
  const withTab = new Set([...context().info.values()].flatMap((x) => [x.pr, ...x.kidPrs]).map((p) => p?.url).filter(Boolean));
  const waiting = (shared("task.prs")?.list ?? []).filter((p) => !p.merged && !withTab.has(p.url)).length;
  return { total: tabs.length + waiting, blocked: tabs.filter((tab) => tab.status === "blocked").length };
}

// Async work from a click goes through that click's cx.
const openUrl = (cx, url) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

// Calm CI colors, the same in the Agents list and the Context card: green passed, amber failed
// (as a failed check in the card), gray still running. No red.
const CI = { SUCCESS: "ansi2", FAILURE: "working", ERROR: "working", PENDING: "dim", EXPECTED: "dim" };
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };

// "#355", colored by review state; a CI dot only while CI runs or after it fails. The state
// and the PR title are in the tooltip; click opens the PR.
export function prChip(t, pr) {
  const state = pr.merged ? "merged" : pr.draft ? "draft" : REVIEW[pr.review] ?? "open";
  const color = pr.merged ? t.ansi5 : pr.draft ? t.dim : pr.review === "CHANGES_REQUESTED" ? t.working : pr.review === "APPROVED" ? t.ansi2 : t.muted;
  const ci = pr.ci && pr.ci !== "SUCCESS" && !pr.merged;
  return h_flex()
    .id(`pr-${pr.url}`)
    .flex_none()
    .h(20)
    .px(7)
    .gap(6)
    .rounded(5)
    .items_center()
    .bg(t.raised)
    .text_size(11)
    .text_color(color)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .tooltip(`${pr.title} (${state})`)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openUrl(cx, pr.url);
    })
    .when(ci, (el) => el.child(div().size(7).rounded(4).flex_none().bg(t[CI[pr.ci]] ?? t.dim)))
    .child(`#${pr.number}`)
    // GitHub's merged purple, from the theme; a tint of it as the chip's background.
    .when(Boolean(pr.merged), (el) => el.bg(t.ansi5 + "26").hover((s) => s.bg(t.ansi5 + "40")));
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
      open ? view.folded.add(id) : view.folded.delete(id);
      cx.notify();
    })
    .child(div().text_color(color).child(label))
    .child(div().text_color(t.dim).child(String(count)))
    .child(div().flex_1())
    .when(!open, (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
}

export function board(view, t) {
  // Going to another tab (agent keys, a click elsewhere) puts the terminals back.
  // With the terminals covered there may be no focused tab: that is not a move.
  const at = focused()?.tab;
  const from = shared("task.boardFrom");
  if (at && from && at !== from && boardShown()) showBoard(false);
  const all = panes();
  const leads = leadPanes(all);
  const { info, prs } = context(all);
  const now = Date.now();

  let tasks = spaces().flatMap((s) => s.tabs.filter((tab) => leads.has(tab.id)).map((tab) => ({ s, tab, lead: leads.get(tab.id), ...info.get(tab.id) })));
  tasks.sort((x, y) => (RANK[y.tab.status] ?? 0) - (RANK[x.tab.status] ?? 0) || (y.tab.changed_at ?? 0) - (x.tab.changed_at ?? 0));
  const withTab = new Set(tasks.flatMap((x) => [x.pr, ...(x.kidPrs ?? [])]).map((p) => p?.url).filter(Boolean));
  const waiting = prs.filter((p) => !p.merged && !withTab.has(p.url));

  // Child agents (hc run from another agent) go under their parent's row, depth first, as in
  // the sidebar. A tab led by a child that is shown that way (another space) gets no row.
  const live = terminals().filter((k) => k.state === "live");
  const paneOf = new Map(all.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const spaceOf = new Map(spaces().flatMap((s) => s.tabs.map((tab) => [tab.id, s])));
  const tree = (addr, lead = []) => {
    const kids = live.filter((k) => k.parent === addr);
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ k, lines: [...lead, last ? "└" : "├"] }, ...tree(k.address, [...lead, last ? "" : "│"])];
    });
  };
  const kidsOf = new Map(tasks.map((x) => [x.tab.id, tree(x.lead.terminal)]));
  const nested = new Set([...kidsOf.values()].flat().map((n) => n.k.address));
  tasks = tasks.filter((x) => !nested.has(x.lead.terminal));

  const kidRow = (x, { k, lines }) => {
    const p = paneOf.get(k.address);
    const own = childLabel(k.address, p, prs);
    const raw = p?.status ?? k.status ?? "idle";
    const st = raw === "error" ? "blocked" : raw;
    const where = p && spaceOf.get(p.tab) !== x.s ? spaceOf.get(p.tab)?.name : null;
    return h_flex()
      .id(`wk-${k.address}`)
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
        run(p ? "agent.focus" : "terminal.peek", { terminal: k.address });
        showBoard(false);
      })
      .children(lines.map((l) => div().self_start().mt(-2).w(9).h(19).mr(5).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .child(div().mr(8).child(icon(k.program, 14, t.foreground) ?? div().w(14)))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).truncate().text_size(12.5).text_color(st === "idle" ? t.muted : t.foreground).tooltip(k.name || k.address).child(own.text || k.name || k.program?.name || k.address))
        .when(Boolean(where), (el) => el.child(div().flex_none().text_size(12.5).text_color(t.dim).child(`· ${where}`))))
      .when(Boolean(own.pr), (el) => el.child(div().ml(10).child(prChip(t, own.pr))))
      .child(st === "blocked" ? div().ml(10).child(statusMark(t, "blocked")) : div().ml(10).w(14).flex_none().flex().justify_center().child(statusMark(t, st)));
  };

  const row = (x) => {
    const { s, tab, lead, kind, pr, lastRun } = x;
    const idle = !tab.status || tab.status === "idle";
    const when = kind.id === "loop" && lastRun ? `ran ${duration(now - lastRun)} ago` : tab.changed_at ? duration(now - tab.changed_at) : "";
    return h_flex()
      .id(`w-${tab.id}`)
      .h(34)
      .px(10)
      .gap(10)
      .flex_none()
      .rounded(8)
      .items_center()
      .cursor_pointer()
      .when(tab.active && s.active, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .on_click(() => {
        run("pane.focus", { pane: lead.pane });
        showBoard(false);
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "tasks", kind: "popup", width: 200, height: 310, at: "pointer", props: { kindMenu: tab.id, tabSpace: s.id } });
      })
      .child(icon(lead.program, 16, t.foreground) ?? div().w(16).flex_none())
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().flex_none().text_color(t.dim).child(`${spaceLabel(s.name, lead.cwd)} ·`))
        .child(div().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(title(tab, lead, x))))
      .when(Boolean(pr), (el) => el.child(prChip(t, pr)))
      .when(Boolean(when), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(when)))
      .child(tab.status === "blocked" ? statusMark(t, "blocked") : div().w(14).flex_none().flex().justify_center().child(statusMark(t, tab.status ?? "idle")));
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
    ...KINDS.map((k) => {
      const mine = tasks.filter((x) => x.kind.id === k.id);
      return { id: `k-${k.id}`, label: k.label, color: t[k.color], count: mine.length, rows: mine.flatMap((x) => [row(x), ...kidsOf.get(x.tab.id).map((n) => kidRow(x, n))]) };
    }),
    { id: "k-waiting", label: "Waiting on others", color: t.dim, count: waiting.length, rows: waiting.map(waitingRow) },
  ].filter((g) => g.rows.length);

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
      .children(sections.flatMap((g) => [header(t, view, g.id, g.label, g.color, g.count), ...(view.folded.has(g.id) ? [] : g.rows)])));
}

// The board page's top bar, in the tab bar's place and style (shipped `tabs` mod):
// one active "tab" that names the page, and the PR refresh where the panel buttons are.
export function bar(t) {
  const fetched = shared("task.prs") ?? {};
  const now = Date.now();
  const { total } = summary();
  const stop = (_e, cx) => cx.stop_propagation();
  return h_flex().size_full().min_w(0).px(10).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(h_flex().h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(t.border).bg(t.raised).text_color(t.foreground)
      .child(svg("mods/workspace-chrome/circle-check.svg").size(14).text_color(t.muted))
      .child("Work")
      .child(div().text_color(t.dim).child(String(total))))
    .child(div().flex_1())
    .when(Boolean(fetched.error), (el) => el.child(div().min_w(0).truncate().px(8).text_size(12).text_color(t.blocked).tooltip(fetched.error).child("GitHub failed")))
    .child(h_flex().id("w-refresh").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .tooltip("Refresh PRs")
      .on_click((_e, cx) => cx.spawn(async () => { await refreshPrs(true); }))
      .child(svg("mods/workspace-chrome/git-branch.svg").size(14))
      .child(fetched.at ? `PRs ${duration(now - fetched.at)} ago` : "PRs…"));
}
