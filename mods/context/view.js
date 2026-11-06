// The Context panel's UI. panel(v, t) draws it from the View's state (main.js): v.vm (the card
// model), v.issues, v.prs, v.git, v.agent, and the fold states v.open and v.othersOpen.
// The card has one section per source (Linear, GitHub, Slack, the local branch); every row starts
// with the logo of where its data comes from. A click opens the link.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { readiness, linearLinks, checkList, DEFAULT_BRANCHES } from "./links.js";

const CI = { SUCCESS: "ansi2", FAILURE: "ansi1", ERROR: "ansi1", PENDING: "ansi3", EXPECTED: "ansi3" };
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

const openUrl = (cx, url) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });
// For a click inside a row that is itself a link: open only this one.
const openOnly = (url) => (_e, cx) => { cx.stop_propagation(); if (url) openUrl(cx, url); };

// The small parts every row uses, in the theme's colors.
function kit(t) {
  const dot = (color) => div().size(8).rounded(4).flex_none().bg(color ?? t.dim);
  return {
    t, dot,
    dim: (text) => div().flex_none().text_size(11).text_color(t.dim).child(text),
    // The logos: Simple Icons (CC0), the set of Herdr's own program icons, tinted like the
    // panel's other glyphs. LOGOS.md says where each one comes from.
    logo: (name) => svg(`mods/context/${name}-logo.svg`).size(14).flex_none().text_color(t.muted),
    chevron: (open) => svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none(),
    idTitle: (id, title) => h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(id)).child(div().truncate().child(title ?? "")),
    // A Linear state: its color dot and name.
    state: (st) => h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.dim).child(dot(st?.color)).child(st?.name ?? ""),
  };
}

// A PR's chip data: GitHub's answer when we have it (fresher), else the tasks mod's list.
function prOf(v, l) {
  const g = v.prs[l.url]?.data;
  if (!g) return v.vm.mine.get(l.url.toLowerCase()) ?? null;
  return { title: g.title, merged: g.state === "MERGED", draft: g.isDraft, review: g.reviewDecision, ci: g.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null };
}
// "● in review", "merged", "draft": as the PR chip in the Agents list.
function prStatus(k, p) {
  const { t } = k;
  return !p ? null : h_flex().flex_none().gap(6).items_center().text_size(11)
    .when(Boolean(p.ci) && !p.merged, (el) => el.child(div().size(7).rounded(4).bg(t[CI[p.ci]] ?? t.dim)))
    .child(div().text_color(p.merged ? t.ansi5 : p.review === "CHANGES_REQUESTED" ? t.blocked : t.dim).child(p.merged ? "merged" : p.draft ? "draft" : REVIEW[p.review] ?? "open"));
}

const issueUrl = (v, l) => l.url ?? v.issues[l.key]?.data?.url ?? null;
// One link: its source's logo, ID and title, then its state on the right.
function linkRow(v, k, l) {
  let source, label, meta = null, url = l.url;
  if (l.kind === "issue") {
    const d = v.issues[l.key]?.data;
    [source, label, url] = ["linear", k.idTitle(l.key, d?.title), issueUrl(v, l)];
    if (d) meta = k.state(d.state);
  } else if (l.kind === "pr") {
    const p = prOf(v, l);
    [source, label, meta] = ["github", k.idTitle(`#${l.number}`, p?.title ?? l.repo), prStatus(k, p)];
  } else if (l.kind === "slack") [source, label, meta] = ["slack", "Slack thread", k.dim(day(l.at))];
  else [source, label, meta] = ["linear", l.title, k.dim("doc")];
  return h_flex().id(`link-${l.key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
    .hover((s) => s.bg(k.t.hover)).on_click((_e, cx) => { if (url) openUrl(cx, url); })
    .child(k.logo(source)).child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(meta), (el) => el.child(meta)).when(Boolean(l.start), (el) => el.child(k.dim("started")));
}

// The ticket: its ID and state, title, parent, project, what blocks it and what it blocks (an
// open blocker in the "blocked" color), and how many sub-issues are done.
function issueHead(v, k, l) {
  const { t } = k, d = v.issues[l.key]?.data;
  const { blocks, subs } = linearLinks(d);
  const line = (id) => h_flex().id(id).gap(6).min_w(0).text_size(12).text_color(t.muted).hover((s) => s.text_color(t.foreground));
  return v_flex().id("context-head").p(10).gap(5).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => { const u = issueUrl(v, l); if (u) openUrl(cx, u); })
    .child(h_flex().gap(8).items_center().text_size(12).child(k.logo("linear")).child(div().text_color(t.muted).child(l.key)).child(div().flex_1())
      .when(Boolean(d), (el) => el.child(k.state(d.state))))
    .when(Boolean(d), (el) => el.child(div().font_semibold().child(d.title)))
    .when(Boolean(d?.parent), (el) => el.child(line("context-parent").on_click(openOnly(d.parent.url))
      .child("↳").child(div().flex_none().child(d.parent.identifier)).child(div().flex_1().min_w(0).truncate().child(d.parent.title)).child(k.state(d.parent.state))))
    .when(Boolean(d?.project), (el) => el.child(div().text_size(12).text_color(t.dim).truncate().child(d.project.name)))
    .children(blocks.map((b) => line(`block-${b.key}`).on_click(openOnly(b.url))
      .child(div().flex_none().text_color(b.blocked && !b.done ? t.blocked : t.dim).child(b.blocked ? "Blocked by" : "Blocks"))
      .child(div().flex_none().child(b.key)).child(div().flex_1().min_w(0).truncate().child(b.title ?? "")).child(k.state(b.state))))
    .when(Boolean(subs), (el) => el.child(div().text_size(12).text_color(t.dim).child(`Sub-issues ${subs.done}/${subs.total} done`)));
}

// Under a PR, lined up with its text (INDENT: the row's padding, logo and gap): what blocks it,
// its labels as chips, then the checks that need you (every failing one and every required one
// that hasn't passed). All other checks are in one folded line. A click on a check opens its run.
const INDENT = 30;
const TONE = { bad: "ansi1", good: "ansi2", dim: "dim" };
const CHECK = { failed: "ansi1", running: "ansi3", passed: "ansi2", cancelled: "dim", skipped: "dim" };
function checkRow(k, l, c) {
  const color = k.t[CHECK[c.state]];
  return h_flex().id(`check-${l.key}-${c.name}-${c.state}`).h(22).flex_none().pl(INDENT).pr(8).gap(7).items_center().rounded(5).text_size(12)
    .when(Boolean(c.url), (el) => el.cursor_pointer().hover((s) => s.bg(k.t.hover)).on_click(openOnly(c.url)))
    .child(div().size(7).rounded(4).flex_none().bg(color))
    .child(div().flex_1().min_w(0).truncate().child(c.count > 1 ? `${c.name} ×${c.count}` : c.name))
    .when(c.required, (el) => el.child(k.dim("required")))
    .when(c.state !== "passed", (el) => el.child(div().flex_none().text_size(11).text_color(color).child(c.state)));
}
function prDetails(v, k, l) {
  const { t } = k, g = v.prs[l.url]?.data, checks = checkList(g);
  const out = readiness(g).map((x, i) =>
    div().id(`ready-${l.key}-${i}`).pl(INDENT).pr(8).h(18).flex_none().truncate().text_size(11).text_color(t[TONE[x.tone]]).child(x.text));
  const labels = g?.labels?.nodes ?? [];
  if (labels.length) out.push(h_flex().flex_wrap().gap(4).pl(INDENT).pr(8).py(3).children(labels.map((x) =>
    h_flex().h(18).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted)
      .child(div().size(6).rounded(3).flex_none().bg(`#${x.color}`)).child(x.name))));
  const needs = (c) => c.state === "failed" || (c.required && c.state !== "passed");
  out.push(...checks.filter(needs).map((c) => checkRow(k, l, c)));
  const others = checks.filter((c) => !needs(c));
  if (!others.length) return out;
  const open = v.othersOpen.has(l.url), count = (list) => list.reduce((n, c) => n + c.count, 0);
  const running = count(others.filter((c) => c.state === "running"));
  // The chevron sits in the margin, so the words line up with the lines above.
  out.push(h_flex().id(`others-${l.key}`).h(22).flex_none().pl(INDENT - 19).pr(8).gap(7).items_center().rounded(5).cursor_pointer().text_size(12).text_color(t.dim)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); if (open) v.othersOpen.delete(l.url); else v.othersOpen.add(l.url); cx.notify(); })
    .child(k.chevron(open)).child(`${count(others)} other checks`)
    .when(running > 0, (el) => el.child(div().text_color(t.ansi3).child(`${running} running`))));
  if (open) out.push(...others.map((c) => checkRow(k, l, c)));
  return out;
}

// The local branch: unpushed commits, how far behind its base, uncommitted files. Nothing on
// the default branch, or once the branch's PR is merged ("behind master" is no news then).
function branchLine(v) {
  const g = v.agent ? v.git[v.agent.cwd] : null;
  if (!g || DEFAULT_BRANCHES.has(g.branch)) return "";
  return [...v.vm.mine.values()].some((p) => p.branch === g.branch && p.merged) ? "" : g.line;
}

// The card's sections, one per source, each only when it has something.
function sections(v, k) {
  const { t } = k, { ticket, card } = v.vm;
  const ticketLink = card.find((l) => l.kind === "issue" && l.key === ticket);
  const linear = card.filter((l) => (l.kind === "issue" || l.kind === "doc") && l !== ticketLink);
  const github = card.filter((l) => l.kind === "pr"), slack = card.filter((l) => l.kind === "slack");
  const rows = (list) => v_flex().p(4).gap(1).children(list);
  const line = branchLine(v);
  return [
    ticketLink || linear.length ? v_flex().when(Boolean(ticketLink), (el) => el.child(issueHead(v, k, ticketLink)))
      .when(linear.length > 0, (el) => el.child(rows(linear.map((l) => linkRow(v, k, l))).when(Boolean(ticketLink), (e) => e.pt(0)))) : null,
    github.length ? rows(github.flatMap((l) => [linkRow(v, k, l), ...prDetails(v, k, l)])) : null,
    slack.length ? rows(slack.map((l) => linkRow(v, k, l))) : null,
    line ? h_flex().h(30).px(12).gap(8).items_center().text_size(12).text_color(t.muted)
      .child(svg("mods/context/branch.svg").size(14).flex_none()).child(div().min_w(0).truncate().child(line)) : null,
  ].filter(Boolean);
}

// Links you or the agent mentioned later: one folded line, then the rows.
function later(v, k) {
  const { t } = k, list = v.vm.later;
  return [
    h_flex().id("context-later").h(28).flex_none().mx(4).mt(4).px(6).gap(6).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { v.open = !v.open; localStorage.setItem("open", JSON.stringify(v.open)); cx.notify(); })
      .child(k.chevron(v.open)).child("Mentioned later").child(String(list.length)),
    ...(v.open ? list.map((l) => linkRow(v, k, l)) : []),
  ];
}

export function panel(v, t) {
  const k = kit(t), parts = sections(v, k), hasLater = v.vm.later.length > 0;
  const empty = !v.agent ? "Focus an agent to see what it works on" : v.busy ? "Reading the transcript…" : "No linked work";
  return v_flex().id("context").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
    .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("Context")))
    .child(v_flex().id("context-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
      .when(parts.length > 0, (el) => el.child(v_flex().m(4).flex_none().rounded(8).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
        .children(parts.map((x, i) => (i ? x.border_t(1).border_color(t.border) : x)))))
      .when(hasLater, (el) => el.children(later(v, k)))
      .when(!parts.length && !hasLater, (el) => el.child(div().p(8).text_color(t.dim).child(empty))));
}
