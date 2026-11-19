// One grid, like Linear's issue sidebar: every row is ROW high, icons sit on the header's
// left edge (14 px), text one icon and a gap further (TEXT_X). Sections are split by hairlines.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { readiness, linearLinks, checkList, stackLine, afterMerge, nextStep } from "./links.js";
import { prLook, conf, isFeatureBranch } from "./lib/shared.js";

const EDGE = 8, // a section's side padding; with a row's own PAD, the header's 14 px
  PAD = 6,
  ICON = 14,
  GAP = 8,
  ROW = 28,
  RADIUS = 6,
  LABEL = 76; // the property labels' column: "Blocked by" fits
const TEXT_X = PAD + ICON + GAP; // where a row's text starts, for wrapped text under a row

// Calm: a dot says the state, and nothing is red.
const TONE = { act: "done", good: "ansi2", dim: "dim" };
const CHECK = {
  failed: "working",
  running: "dim",
  passed: "ansi2",
  cancelled: "dim",
  skipped: "dim",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const openUrl = (cx, url) =>
  cx.spawn(async () => {
    await exec("open", [url]).catch(() => null);
  });

function kit(t) {
  const dot = (color, size = 8) =>
    div()
      .size(size)
      .rounded(size / 2)
      .flex_none()
      .bg(color ?? t.dim);
  return {
    t,
    dot,
    // Right-side text gives way three times faster than the row's own label.
    small: (text, color = t.dim) =>
      div()
        .flex_initial()
        .flex_shrink(3)
        .min_w(0)
        .truncate()
        .text_size(12)
        .text_color(color)
        .child(text),
    lead: (child) =>
      div()
        .w(ICON)
        .flex_none()
        .flex()
        .justify_center()
        .when(Boolean(child), (el) => el.child(child)),
    logo: (file) => svg(`mods/context/${file}.svg`).size(ICON).text_color(t.muted),
    chevron: (open) => svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12),
    // Every row: one height, one radius, a lead column. A url or onClick makes it clickable.
    row: (id, url, onClick) =>
      h_flex()
        .id(id)
        .h(ROW)
        .flex_none()
        .px(PAD)
        .gap(GAP)
        .items_center()
        .rounded(RADIUS)
        .when(Boolean(url || onClick), (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover))
            .on_click(
              onClick ??
                ((_e, cx) => {
                  cx.stop_propagation();
                  openUrl(cx, url);
                }),
            ),
        ),
    fill: (child) => div().flex_auto().min_w(0).truncate().child(child),
    idTitle: (id, title) =>
      h_flex()
        .flex_auto()
        .min_w(0)
        .gap(6)
        .child(div().flex_none().text_color(t.muted).child(id))
        .child(
          div()
            .min_w(0)
            .truncate()
            .child(title ?? ""),
        ),
    wrapped: (text) => div().pl(TEXT_X).pr(PAD).pb(6).child(text),
  };
}

// A section: a small header (logo and name), then its rows.
function section(ui, id, { icon, name, rows }) {
  return v_flex()
    .id(id)
    .flex_none()
    .px(EDGE)
    .py(6)
    .child(
      ui
        .row(`${id}-head`)
        .text_size(12)
        .text_color(ui.t.dim)
        .child(ui.lead(icon))
        .child(ui.fill(name)),
    )
    .children(rows.filter(Boolean));
}

// "Blocked by   ● ABC-4398  Drop the FK        Done"
function property(ui, id, { label, strong, color, key, title, state, url }) {
  const { t } = ui;
  return ui
    .row(id, url)
    .child(ui.lead(null))
    .child(
      div()
        .w(LABEL)
        .flex_none()
        .text_size(12)
        .text_color(strong ? t.foreground : t.dim)
        .child(label),
    )
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(6)
        .items_center()
        .when(Boolean(color), (el) => el.child(ui.dot(color, 6)))
        .child(ui.idTitle(key, title)),
    )
    .when(Boolean(state), (el) => el.child(ui.small(state)));
}

// A status line: a dot in the lead column, then the text.
function status(ui, id, { text, tone, url }) {
  return ui
    .row(id, url)
    .child(ui.lead(ui.dot(ui.t[TONE[tone]], 6)))
    .child(ui.fill(text).text_color(tone === "act" ? ui.t.foreground : ui.t.muted));
}

// GitHub's answer when we have it (fresher), else the tasks mod's list.
function prOf(view, link) {
  const prData = view.prs[link.url]?.data;
  if (!prData) return view.vm.mine.get(link.url.toLowerCase()) ?? null;
  return {
    title: prData.title,
    merged: prData.state === "MERGED",
    draft: prData.isDraft,
    review: prData.reviewDecision,
    ci: prData.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
  };
}

const issueUrl = (view, link) => link.url ?? view.issues[link.key]?.data?.url ?? null;

// A row in "More from the task": a logo, an ID and a title.
function linkRow(view, ui, link) {
  let logo,
    label,
    meta = null;
  if (link.kind === "issue") {
    const d = view.issues[link.key]?.data;
    [logo, label, meta] = ["linear-logo", ui.idTitle(link.key, d?.title), d?.state?.name];
  } else if (link.kind === "pr") {
    const pr = prOf(view, link);
    [logo, label] = ["github-logo", ui.idTitle(`#${link.number}`, pr?.title ?? link.repo)];
    meta = pr && prLook(ui.t, pr).label;
  } else if (link.kind === "slack")
    [logo, label, meta] = ["slack-logo", ui.fill("Slack thread"), day(link.at)];
  else [logo, label, meta] = ["linear-logo", ui.fill(link.title), "doc"];
  const url = link.kind === "issue" ? issueUrl(view, link) : link.url;
  return ui
    .row(`link-${link.key}`, url)
    .child(ui.lead(ui.logo(logo)))
    .child(label)
    .when(Boolean(meta), (el) => el.child(ui.small(meta)));
}

function linear(view, ui, ticketLink, others) {
  const { t } = ui,
    d = ticketLink ? view.issues[ticketLink.key]?.data : null;
  const rows = [];
  if (ticketLink) {
    rows.push(
      ui
        .row("issue", issueUrl(view, ticketLink))
        .child(ui.lead(ui.dot(d?.state?.color)))
        .child(ui.fill(ticketLink.key).text_color(t.muted))
        .when(Boolean(d), (el) => el.child(ui.small(d.state?.name))),
    );
    if (d) rows.push(ui.wrapped(d.title).font_medium());
    const { blocks, subs } = linearLinks(d);
    if (d?.project)
      rows.push(
        property(ui, "project", { label: "Project", key: d.project.name, url: d.project.url }),
      );
    if (d?.parent)
      rows.push(
        property(ui, "parent", {
          label: "Parent",
          color: d.parent.state?.color,
          key: d.parent.identifier,
          title: d.parent.title,
          state: d.parent.state?.name,
          url: d.parent.url,
        }),
      );
    for (const block of blocks)
      rows.push(
        property(ui, `rel-${block.key}`, {
          label: block.blocked ? "Blocked by" : "Blocks",
          strong: block.blocked && !block.done,
          color: block.state?.color,
          key: block.key,
          title: block.title,
          state: block.state?.name,
          url: block.url,
        }),
      );
    if (subs)
      rows.push(
        ui
          .row("subs")
          .child(ui.lead(null))
          .child(div().w(LABEL).flex_none().text_size(12).text_color(t.dim).child("Sub-issues"))
          .child(
            div()
              .w(48)
              .h(4)
              .flex_none()
              .rounded(2)
              .bg(t.raised)
              .child(
                div()
                  .h_full()
                  .rounded(2)
                  .bg(t.ansi2)
                  .w(Math.round((48 * subs.done) / subs.total)),
              ),
          )
          .child(ui.small(`${subs.done} of ${subs.total}`, t.muted)),
      );
  }
  for (const link of others) {
    const od = link.kind === "issue" ? view.issues[link.key]?.data : null;
    rows.push(
      property(
        ui,
        `in-task-${link.key}`,
        link.kind === "issue"
          ? {
              label: "In the task",
              color: od?.state?.color,
              key: link.key,
              title: od?.title,
              state: od?.state?.name,
              url: issueUrl(view, link),
            }
          : { label: "In the task", key: link.title, state: "doc", url: link.url },
      ),
    );
  }
  return section(ui, "linear", { icon: ui.logo("linear-logo"), name: "Linear", rows });
}

function checkRow(ui, link, check) {
  const color = ui.t[CHECK[check.state]];
  return ui
    .row(`check-${link.key}-${check.name}-${check.state}`, check.url)
    .child(ui.lead(ui.dot(color, 6)))
    .child(
      ui
        .fill(check.count > 1 ? `${check.name} ×${check.count}` : check.name)
        .text_color(ui.t.muted),
    )
    .when(check.required, (el) => el.child(ui.small("required")))
    .when(check.state !== "passed", (el) => el.child(ui.small(check.state, color)));
}

// One PR: its row, then what needs you. Checks that don't fold into one line.
function prRows(view, ui, link) {
  const { t } = ui,
    prData = view.prs[link.url]?.data,
    pr = prOf(view, link),
    look = pr && prLook(t, pr);
  const out = [
    ui
      .row(`pr-${link.key}`, link.url)
      .child(ui.lead(ui.dot(look?.fill?.fg ?? t.dim)))
      .child(ui.idTitle(`#${link.number}`, pr?.title ?? link.repo))
      .when(Boolean(look), (el) => el.child(ui.small(look.label, look.fill?.fg ?? t.dim))),
  ];
  const stack = stackLine(prData, [...view.vm.mine.values()], link.repo);
  if (stack)
    out.push(
      property(ui, `stack-${link.key}`, {
        label: "Stacked on",
        strong: Boolean(stack.mergedBase),
        color: stack.base?.merged ? t.ansi5 : t.dim,
        key: stack.base ? `#${stack.base.number}` : stack.baseName,
        title: stack.base?.title,
        state: stack.base ? (stack.base.merged ? "merged" : "open") : null,
        url: stack.base?.url,
      }),
    );
  [...readiness(prData), ...afterMerge(prData)].forEach((line, i) =>
    out.push(status(ui, `ready-${link.key}-${i}`, line)),
  );
  const labels = prData?.labels?.nodes ?? [];
  if (labels.length)
    out.push(
      h_flex()
        .flex_wrap()
        .gap(4)
        .pl(TEXT_X)
        .pr(PAD)
        .py(4)
        .children(
          labels.map((label) =>
            h_flex()
              .h(20)
              .px(6)
              .gap(5)
              .items_center()
              .rounded(RADIUS)
              .border_1()
              .border_color(t.border)
              .text_size(12)
              .text_color(t.muted)
              .child(ui.dot(`#${label.color}`, 6))
              .child(label.name),
          ),
        ),
    );
  const checks = checkList(prData);
  // A skipped check counts as passed on GitHub, so only a running or cancelled required one waits.
  const needs = (check) =>
    check.state === "failed" ||
    (check.required && (check.state === "running" || check.state === "cancelled"));
  out.push(...checks.filter(needs).map((check) => checkRow(ui, link, check)));
  const others = checks.filter((check) => !needs(check));
  if (!others.length) return out;
  const open = view.othersOpen.has(link.url),
    count = (list) => list.reduce((n, check) => n + check.count, 0);
  const running = count(others.filter((check) => check.state === "running"));
  out.push(
    ui
      .row(`others-${link.key}`, null, (_e, cx) => {
        cx.stop_propagation();
        if (open) view.othersOpen.delete(link.url);
        else view.othersOpen.add(link.url);
        cx.notify();
      })
      .text_color(t.dim)
      .child(ui.lead(ui.chevron(open)))
      .child(
        ui.fill(`${plural(count(others), "other check")}${running ? ` · ${running} running` : ""}`),
      ),
  );
  if (open) out.push(...others.map((check) => checkRow(ui, link, check)));
  return out;
}

// None on the default branch and once the branch's PR is merged.
function branchState(view) {
  const git = view.agent ? view.git[view.agent.cwd] : null;
  if (!isFeatureBranch(git?.branch)) return null;
  if ([...view.vm.mine.values()].some((pr) => pr.branch === git.branch && pr.merged)) return null;
  return git;
}

function github(view, ui, prs) {
  const git = branchState(view),
    branchIcon = () => svg("mods/context/branch.svg").size(ICON).text_color(ui.t.dim);
  const rows = prs.flatMap((link) => prRows(view, ui, link));
  if (git)
    rows.push(
      ui
        .row("branch")
        .child(ui.lead(branchIcon()))
        .child(ui.fill(git.branch).text_color(ui.t.muted))
        .when(Boolean(git.line), (el) => el.child(ui.small(git.line))),
    );
  if (!rows.length) return null;
  return prs.length
    ? section(ui, "github", { icon: ui.logo("github-logo"), name: "GitHub", rows })
    : section(ui, "git", { icon: branchIcon(), name: "Branch", rows });
}

// Haiku's summary, or the parent's first line until it answers.
function slack(view, ui, links) {
  if (!links.length) return null;
  const rows = links.flatMap((link) => {
    const thread = view.threads[link.url],
      text = thread?.summary ?? thread?.first;
    return [
      ui
        .row(`slack-${link.key}`, link.url)
        .child(ui.lead(null))
        .child(ui.fill(thread?.author ?? "Thread").text_color(ui.t.muted))
        .child(
          ui.small(
            [thread?.replies ? plural(thread.replies, "reply", "replies") : null, day(link.at)]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
      text ? ui.wrapped(text) : null,
    ];
  });
  return section(ui, "slack", { icon: ui.logo("slack-logo"), name: "Slack", rows });
}

// The agent's PR: the PR of its branch, else the first open one, else the first.
function next(view, ui, prs, ticketData) {
  const branch = view.agent ? view.git[view.agent.cwd]?.branch : null;
  const data = (link) => view.prs[link.url]?.data;
  const pr =
    prs.find((link) => branch && view.vm.mine.get(link.url.toLowerCase())?.branch === branch) ??
    prs.find((link) => data(link)?.state === "OPEN") ??
    prs[0];
  const prData = pr ? data(pr) : null;
  const step = nextStep({
    pr: prData,
    stack: pr && stackLine(prData, [...view.vm.mine.values()], pr.repo),
    blocks: linearLinks(ticketData).blocks,
    issueState: ticketData?.state?.name,
    reviewLabel: conf().reviewLabel ?? "",
  });
  if (!step) return null;
  return v_flex()
    .id("next")
    .flex_none()
    .p(EDGE)
    .child(status(ui, "next-row", step).bg(ui.t.surface));
}

// The ticket's own lines already show it, its parent and its blockers.
function relatedKeys(view) {
  const d = view.issues[view.vm.ticket]?.data;
  return new Set([
    view.vm.ticket,
    d?.parent?.identifier,
    ...linearLinks(d).blocks.map((block) => block.key),
  ]);
}

function more(view, ui) {
  const related = relatedKeys(view),
    list = view.vm.more.filter((link) => !related.has(link.key));
  if (!list.length) return null;
  const toggle = (_e, cx) => {
    view.open = !view.open;
    localStorage.setItem("open", JSON.stringify(view.open));
    cx.notify();
  };
  return v_flex()
    .id("more")
    .flex_none()
    .px(EDGE)
    .py(6)
    .child(
      ui
        .row("more-head", null, toggle)
        .text_size(12)
        .text_color(ui.t.dim)
        .child(ui.lead(ui.chevron(view.open)))
        .child(ui.fill("More from the task"))
        .child(ui.small(String(list.length))),
    )
    .when(view.open, (el) => el.children(list.map((link) => linkRow(view, ui, link))));
}

function sections(view, ui) {
  const { ticket, card } = view.vm;
  const ticketLink = card.find((link) => link.kind === "issue" && link.key === ticket);
  const related = relatedKeys(view);
  const otherLinear = card.filter(
    (link) => (link.kind === "issue" || link.kind === "doc") && !related.has(link.key),
  );
  const prs = card.filter((link) => link.kind === "pr");
  const linearPart =
    ticketLink || otherLinear.length ? linear(view, ui, ticketLink, otherLinear) : null;
  const githubPart = github(view, ui, prs);
  const slackPart = slack(
    view,
    ui,
    card.filter((link) => link.kind === "slack"),
  );
  // The main link's source comes first.
  const sources = {
    slack: [slackPart, linearPart, githubPart],
    pr: [githubPart, linearPart, slackPart],
  }[card[0]?.kind] ?? [linearPart, githubPart, slackPart];
  const ticketData = ticketLink ? view.issues[ticketLink.key]?.data : null;
  return {
    nextPart: next(view, ui, prs, ticketData),
    parts: [...sources, more(view, ui)].filter(Boolean),
  };
}

export function panel(view, t) {
  const ui = kit(t),
    { nextPart, parts } = sections(view, ui);
  const empty = !view.agent
    ? "Focus an agent to see what it works on"
    : view.busy
      ? "Reading the transcript…"
      : "No linked work";
  return v_flex()
    .id("context")
    .size_full()
    .min_h(0)
    .rounded(10)
    .overflow_hidden()
    .bg(t.background)
    .border_1()
    .border_color(t.border)
    .text_color(t.foreground)
    .text_size(13)
    .child(
      h_flex()
        .h(42)
        .flex_none()
        .px(EDGE + PAD)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(div().font_semibold().child("Context"))
        .when(Boolean(view.demo), (el) =>
          el.child(div().flex_1().text_right().text_size(12).text_color(t.dim).child(view.demo)),
        ),
    )
    .child(
      v_flex()
        .id("context-list")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .when(Boolean(nextPart), (el) => el.child(nextPart))
        .children(
          parts.map((part, i) => (i || nextPart ? part.border_t(1).border_color(t.border) : part)),
        )
        .when(!parts.length && !nextPart, (el) =>
          el.child(
            div()
              .px(EDGE + PAD)
              .py(12)
              .text_size(12)
              .text_color(t.dim)
              .child(empty),
          ),
        ),
    );
}
