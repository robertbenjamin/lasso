// The Context panel's UI. panel(v, t) draws it from the View's state (main.js): v.vm (the card
// model), v.issues, v.prs, v.git, v.agent, and the fold states v.open and v.othersOpen.
// The card: the "Next" answer, then one section per source (Linear, GitHub, Slack, the local
// branch). A click opens the link.
//
// One grid for every part, so all sections line up:
// - two columns: logos and dots in the first (ICON wide), all text in the second;
// - rows: LINK high for a link, LINE high for every detail line under it (readiness, relations,
//   checks), all in 12 px text;
// - relation labels ("Blocked by", "Stacked on") in one LABEL-wide column, so the IDs line up.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { readiness, linearLinks, checkList, stackLine, afterMerge, nextStep, DEFAULT_BRANCHES } from "./links.js";

const PAD = 8; // a row's padding, from its section's 4 px inset to the first column
const ICON = 14, GAP = 8; // the first column, and the space before the text
const INDENT = PAD + ICON + GAP; // where the text starts in a section's rows
const LINK = 28, LINE = 22, LABEL = 72;

const CI = { SUCCESS: "ansi2", FAILURE: "ansi1", ERROR: "ansi1", PENDING: "ansi3", EXPECTED: "ansi3" };
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };
// Calm colors: text stays in the normal or dim color, and a small dot says the state, in the
// colors the Agents list uses for the same meaning: blue ("done": your turn), gray (waiting),
// green (merged, deployed). No red: a failed check is amber, a running one gray.
const TEXT = { act: "foreground", good: "ansi2", dim: "dim" };
const DOT = { act: "done", good: "ansi2", dim: "dim" };
const CHECK = { failed: "working", running: "dim", passed: "ansi2", cancelled: "dim", skipped: "dim" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

const openUrl = (cx, url) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });
// For a click inside a row that is itself a link: open only this one.
const openOnly = (url) => (_e, cx) => { cx.stop_propagation(); if (url) openUrl(cx, url); };

// The small parts every row uses, in the theme's colors.
function kit(t) {
  const dot = (color, size = 8) => div().size(size).rounded(size / 2).flex_none().bg(color ?? t.dim);
  return {
    t, dot,
    dim: (text) => div().flex_none().text_size(11).text_color(t.dim).child(text),
    // The logos: Simple Icons (CC0), the set of Herdr's own program icons, tinted like the
    // panel's other glyphs. LOGOS.md says where each one comes from.
    logo: (name) => svg(`mods/context/${name}-logo.svg`).size(ICON).flex_none().text_color(t.muted),
    // A dot or chevron in the first column, centered, so the text after it starts where the
    // logos' text does.
    mark: (color) => div().w(ICON).flex_none().flex().justify_center().child(dot(color)),
    chevron: (open) => div().w(ICON).flex_none().flex().justify_center().child(svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12)),
    idTitle: (id, title) => h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(id)).child(div().truncate().child(title ?? "")),
    // A Linear state: its color dot and name.
    state: (st) => h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.dim).child(dot(st?.color)).child(st?.name ?? ""),
    // A detail line: LINE high, 12 px text, starting at `indent`.
    line: (id, indent) => h_flex().id(id).h(LINE).flex_none().pl(indent).pr(PAD).gap(GAP).items_center().rounded(5).text_size(12),
  };
}

// A relation: "Blocked by  ● THU-4398  Drop the FK   Done". The label in its own column, then
// the other item's dot, ID and title, and its state on the right. A click opens the other item.
function relation(k, id, indent, { label, strong, color, key, title, state, url }) {
  const { t } = k;
  return k.line(id, indent).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(openOnly(url))
    .child(div().w(LABEL).flex_none().text_color(strong ? t.foreground : t.dim).child(label))
    .child(h_flex().flex_1().min_w(0).gap(6).items_center()
      .child(k.dot(color)).child(div().flex_none().text_color(t.muted).child(key)).child(div().flex_1().min_w(0).truncate().child(title ?? "")))
    .when(Boolean(state), (el) => el.child(k.dim(state)));
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
// One link: its source's logo, ID and title, then its state on the right. `started` marks a
// link from the task, where no heading already says so.
function linkRow(v, k, l, { started = true } = {}) {
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
  return h_flex().id(`link-${l.key}`).h(LINK).flex_none().px(PAD).gap(GAP).items_center().rounded(7).cursor_pointer()
    .hover((s) => s.bg(k.t.hover)).on_click((_e, cx) => { if (url) openUrl(cx, url); })
    .child(k.logo(source)).child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(meta), (el) => el.child(meta)).when(started && Boolean(l.start), (el) => el.child(k.dim("started")));
}

// The ticket, as on Linear's own issue page: where it sits (project › parent), its ID and
// state, its title (the card's only bold line), then its relations in one labeled column.
function issueHead(v, k, l) {
  const { t } = k, d = v.issues[l.key]?.data;
  const { blocks, subs } = linearLinks(d);
  const crumb = (id, text, url) => div().id(id).min_w(0).truncate().cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(openOnly(url)).child(text);
  const crumbs = [
    d?.project && crumb("crumb-project", d.project.name, d.project.url),
    d?.parent && crumb("crumb-parent", `${d.parent.identifier} ${d.parent.title}`, d.parent.url),
  ].filter(Boolean);
  const rel = blocks.map((b) => relation(k, `block-${b.key}`, 0, {
    label: b.blocked ? "Blocked by" : "Blocks", strong: b.blocked && !b.done,
    color: b.state?.color, key: b.key, title: b.title, state: b.state?.name, url: b.url,
  }));
  if (subs) rel.push(k.line("subs", 0).text_color(t.dim)
    .child(div().w(LABEL).flex_none().child("Sub-issues"))
    .child(div().w(56).h(4).flex_none().rounded(2).bg(t.raised).child(div().h_full().rounded(2).bg(t.ansi2).w(Math.round((56 * subs.done) / subs.total))))
    .child(`${subs.done} of ${subs.total} done`));
  return v_flex().id("context-head").px(PAD + 4).py(10).gap(4).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => { const u = issueUrl(v, l); if (u) openUrl(cx, u); })
    .when(crumbs.length > 0, (el) => el.child(h_flex().pl(ICON + GAP).gap(5).min_w(0).text_size(12).text_color(t.dim)
      .children(crumbs.flatMap((c, i) => (i ? [div().flex_none().child("›"), c] : [c])))))
    .child(h_flex().gap(GAP).items_center().text_size(12).child(k.logo("linear")).child(div().text_color(t.muted).child(l.key)).child(div().flex_1())
      .when(Boolean(d), (el) => el.child(k.state(d.state))))
    .when(Boolean(d), (el) => el.child(div().pl(ICON + GAP).font_semibold().child(d.title)))
    .when(rel.length > 0, (el) => el.child(v_flex().pl(ICON + GAP).pt(4).children(rel)));
}

// One failing, required or folded check: its state dot, name, "required", and its state.
function checkRow(k, l, c) {
  const color = k.t[CHECK[c.state]];
  return k.line(`check-${l.key}-${c.name}-${c.state}`, INDENT)
    .when(Boolean(c.url), (el) => el.cursor_pointer().hover((s) => s.bg(k.t.hover)).on_click(openOnly(c.url)))
    .child(k.dot(color, 7))
    .child(div().flex_1().min_w(0).truncate().child(c.count > 1 ? `${c.name} ×${c.count}` : c.name))
    .when(c.required, (el) => el.child(k.dim("required")))
    .when(c.state !== "passed", (el) => el.child(div().flex_none().text_size(11).text_color(color).child(c.state)));
}
// Under a PR, in the text column: the PR it is stacked on (a relation, as under the ticket),
// what blocks it (or, once merged, its release and deploy), its labels as chips, then the checks
// that need you (every failing one, every required one that hasn't passed). All other checks
// are in one folded line. A click on a check opens its run.
function prDetails(v, k, l) {
  const { t } = k, g = v.prs[l.url]?.data, checks = checkList(g);
  const out = [];
  const stack = stackLine(g, [...v.vm.mine.values()], l.repo);
  if (stack) out.push(relation(k, `stack-${l.key}`, INDENT, {
    label: "Stacked on", strong: Boolean(stack.mergedBase), color: stack.base?.merged ? t.ansi5 : t.dim,
    key: stack.base ? `#${stack.base.number}` : stack.baseName, title: stack.base?.title,
    state: stack.base ? (stack.base.merged ? "merged" : "open") : null, url: stack.base?.url,
  }));
  out.push(...[...readiness(g), ...afterMerge(g)].map((x, i) => k.line(`ready-${l.key}-${i}`, INDENT).text_color(t[TEXT[x.tone]]).child(div().min_w(0).truncate().child(x.text))));
  const labels = g?.labels?.nodes ?? [];
  if (labels.length) out.push(h_flex().flex_wrap().gap(4).pl(INDENT).pr(PAD).py(3).children(labels.map((x) =>
    h_flex().h(18).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted)
      .child(k.dot(`#${x.color}`, 6)).child(x.name))));
  const needs = (c) => c.state === "failed" || (c.required && c.state !== "passed");
  out.push(...checks.filter(needs).map((c) => checkRow(k, l, c)));
  const others = checks.filter((c) => !needs(c));
  if (!others.length) return out;
  const open = v.othersOpen.has(l.url), count = (list) => list.reduce((n, c) => n + c.count, 0);
  const running = count(others.filter((c) => c.state === "running"));
  // The chevron sits in the first column, so the words line up with the lines above.
  out.push(k.line(`others-${l.key}`, PAD).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => { cx.stop_propagation(); if (open) v.othersOpen.delete(l.url); else v.othersOpen.add(l.url); cx.notify(); })
    .child(k.chevron(open)).child(`${count(others)} other checks${running ? ` · ${running} running` : ""}`));
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

// The one answer at the top of the card (nextStep()), from the agent's PR: the PR of its
// branch, else the first open one, else the first.
function nextLine(v, k, github, ticketData) {
  const branch = v.agent ? v.git[v.agent.cwd]?.branch : null;
  const data = (l) => v.prs[l.url]?.data;
  const pr = github.find((l) => branch && v.vm.mine.get(l.url.toLowerCase())?.branch === branch)
    ?? github.find((l) => data(l)?.state === "OPEN") ?? github[0];
  const g = pr ? data(pr) : null;
  const next = nextStep({ g, stack: pr && stackLine(g, [...v.vm.mine.values()], pr.repo), blocks: linearLinks(ticketData).blocks, issueState: ticketData?.state?.name });
  if (!next) return null;
  return h_flex().h(34).px(PAD + 4).gap(GAP).items_center().text_size(12).font_semibold().text_color(k.t.foreground)
    .child(k.mark(k.t[DOT[next.tone]])).child(div().min_w(0).truncate().child(next.text));
}

// A small heading inside a section, in the text column: why the rows under it are there.
const heading = (k, text) => div().h(LINE).flex_none().pl(INDENT).flex().items_center().text_size(11).text_color(k.t.dim).child(text);

// The card's sections: the "Next" answer, then one per source, each only when it has something.
function sections(v, k) {
  const { t } = k, { ticket, card } = v.vm;
  const ticketLink = card.find((l) => l.kind === "issue" && l.key === ticket);
  const linear = card.filter((l) => (l.kind === "issue" || l.kind === "doc") && l !== ticketLink);
  const github = card.filter((l) => l.kind === "pr"), slack = card.filter((l) => l.kind === "slack");
  const rows = (list) => v_flex().p(4).gap(1).children(list);
  const line = branchLine(v);
  // Other Linear items from the task: under the ticket, with a heading that says why.
  const also = linear.length ? rows([...(ticketLink ? [heading(k, "Also in the task")] : []), ...linear.map((l) => linkRow(v, k, l, { started: !ticketLink }))]) : null;
  return [
    nextLine(v, k, github, ticketLink ? v.issues[ticketLink.key]?.data : null),
    ticketLink || also ? v_flex().when(Boolean(ticketLink), (el) => el.child(issueHead(v, k, ticketLink))).when(Boolean(also), (el) => el.child(ticketLink ? also.pt(0) : also)) : null,
    github.length ? rows(github.flatMap((l) => [linkRow(v, k, l), ...prDetails(v, k, l)])) : null,
    slack.length ? rows(slack.map((l) => linkRow(v, k, l))) : null,
    line ? h_flex().h(34).px(PAD + 4).gap(GAP).items_center().text_size(12).text_color(t.muted)
      .child(svg("mods/context/branch.svg").size(ICON).flex_none()).child(div().min_w(0).truncate().child(line)) : null,
  ].filter(Boolean);
}

// Links you or the agent mentioned later: one folded line, then the rows, on the card's grid
// (the card's inset: its 4 px margin, 1 px border and 4 px padding).
function later(v, k) {
  const { t } = k, list = v.vm.later;
  return v_flex().mx(4).mt(4).px(5).gap(1)
    .child(h_flex().id("context-later").h(LINK).flex_none().px(PAD).gap(GAP).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { v.open = !v.open; localStorage.setItem("open", JSON.stringify(v.open)); cx.notify(); })
      .child(k.chevron(v.open)).child(`Mentioned later · ${list.length}`))
    .when(v.open, (el) => el.children(list.map((l) => linkRow(v, k, l))));
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
      .when(hasLater, (el) => el.child(later(v, k)))
      .when(!parts.length && !hasLater, (el) => el.child(div().p(8).text_color(t.dim).child(empty))));
}
