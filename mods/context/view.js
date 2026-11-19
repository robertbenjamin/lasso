// One grid, so all sections line up: logos and dots in the first column (ICON wide), text in
// the second.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { readiness, linearLinks, checkList, stackLine, afterMerge, nextStep } from "./links.js";
import { prLook, conf, isFeatureBranch } from "./lib/shared.js";

const PAD = 8; // from a section's 4 px inset to the first column
const ICON = 14,
  GAP = 7; // the Changes panel's row gap
const INDENT = PAD + ICON + GAP; // where the text starts in a section's rows
const CARD = 3; // card inset: its radius (10) is a row's (7) plus this
const LINK = 28,
  LINE = 22,
  LABEL = 72;

// Calm: a dot says the state, and nothing is red.
const TEXT = { act: "muted", good: "ansi2", dim: "dim" };
const DOT = { act: "done", good: "ansi2", dim: "dim" };
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

const openUrl = (cx, url) =>
  cx.spawn(async () => {
    await exec("open", [url]).catch(() => null);
  });
// For a click inside a row that is itself a link: open only this one.
const openOnly = (url) => (_e, cx) => {
  cx.stop_propagation();
  if (url) openUrl(cx, url);
};

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
    dim: (text) => div().flex_none().text_size(11).text_color(t.dim).child(text),
    logo: (name) => svg(`mods/context/${name}-logo.svg`).size(ICON).flex_none().text_color(t.muted),
    mark: (color) => div().w(ICON).flex_none().flex().justify_center().child(dot(color)),
    chevron: (open) =>
      div()
        .w(ICON)
        .flex_none()
        .flex()
        .justify_center()
        .child(svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12)),
    idTitle: (id, title) =>
      h_flex()
        .gap(6)
        .min_w(0)
        .child(div().flex_none().text_color(t.muted).child(id))
        .child(
          div()
            .truncate()
            .child(title ?? ""),
        ),
    state: (st) =>
      h_flex()
        .flex_none()
        .gap(5)
        .items_center()
        .text_size(11)
        .text_color(t.dim)
        .child(dot(st?.color))
        .child(st?.name ?? ""),
    line: (id, indent) =>
      h_flex()
        .id(id)
        .h(LINE)
        .flex_none()
        .pl(indent)
        .pr(PAD)
        .gap(GAP)
        .items_center()
        .rounded(7)
        .text_size(12),
  };
}

// "Blocked by  ● ABC-4398  Drop the FK   Done"
function relation(ui, id, indent, { label, strong, color, key, title, state, url }) {
  const { t } = ui;
  return ui
    .line(id, indent)
    .text_color(t.muted)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(openOnly(url))
    .child(
      div()
        .w(LABEL)
        .flex_none()
        .text_color(strong ? t.foreground : t.dim)
        .child(label),
    )
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(6)
        .items_center()
        .when(Boolean(color), (el) => el.child(ui.dot(color)))
        .child(div().flex_none().text_color(t.muted).child(key))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .child(title ?? ""),
        ),
    )
    .when(Boolean(state), (el) => el.child(ui.dim(state)));
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
function prStatus(ui, pr) {
  if (!pr) return null;
  const { label, fill } = prLook(ui.t, pr);
  return div()
    .flex_none()
    .text_size(11)
    .text_color(fill?.fg ?? ui.t.dim)
    .child(label);
}

const issueUrl = (view, link) => link.url ?? view.issues[link.key]?.data?.url ?? null;
function linkRow(view, ui, link) {
  let source,
    label,
    meta = null,
    url = link.url;
  if (link.kind === "issue") {
    const d = view.issues[link.key]?.data;
    [source, label, url] = ["linear", ui.idTitle(link.key, d?.title), issueUrl(view, link)];
    if (d) meta = ui.state(d.state);
  } else if (link.kind === "pr") {
    const pr = prOf(view, link);
    [source, label, meta] = [
      "github",
      ui.idTitle(`#${link.number}`, pr?.title ?? link.repo),
      prStatus(ui, pr),
    ];
  } else if (link.kind === "slack") {
    const thread = view.threads[link.url],
      replies = thread?.replies
        ? `${thread.replies} repl${thread.replies === 1 ? "y" : "ies"} · `
        : "";
    [source, label, meta] = [
      "slack",
      thread?.author ?? "Slack thread",
      ui.dim(replies + day(link.at)),
    ];
  } else [source, label, meta] = ["linear", link.title, ui.dim("doc")];
  return h_flex()
    .id(`link-${link.key}`)
    .h(LINK)
    .flex_none()
    .px(PAD)
    .gap(GAP)
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .hover((s) => s.bg(ui.t.hover))
    .on_click((_e, cx) => {
      if (url) openUrl(cx, url);
    })
    .child(ui.logo(source))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(meta), (el) => el.child(meta));
}

// The thread's summary, or its first line until Haiku answers.
function slackRows(view, ui, link) {
  const thread = view.threads[link.url],
    text = thread?.summary ?? thread?.first;
  return [
    linkRow(view, ui, link),
    ...(text
      ? [div().pl(INDENT).pr(PAD).pb(6).text_size(12).text_color(ui.t.muted).child(text)]
      : []),
  ];
}

function issueHead(view, ui, link) {
  const { t } = ui,
    d = view.issues[link.key]?.data,
    url = issueUrl(view, link);
  const { blocks, subs } = linearLinks(d);
  const rel = (id, fields) => relation(ui, id, INDENT, fields);
  const out = [
    v_flex()
      .id("context-head")
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (url) openUrl(cx, url);
      })
      .child(
        h_flex()
          .h(LINK)
          .px(PAD)
          .gap(GAP)
          .items_center()
          .child(ui.logo("linear"))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(link.key))
          .when(Boolean(d), (el) => el.child(ui.state(d.state))),
      )
      .when(Boolean(d), (el) =>
        el.child(div().pl(INDENT).pr(PAD).pb(6).font_medium().child(d.title)),
      ),
  ];
  if (d?.project)
    out.push(rel("rel-project", { label: "Project", key: d.project.name, url: d.project.url }));
  if (d?.parent)
    out.push(
      rel("rel-parent", {
        label: "Parent",
        color: d.parent.state?.color,
        key: d.parent.identifier,
        title: d.parent.title,
        state: d.parent.state?.name,
        url: d.parent.url,
      }),
    );
  for (const block of blocks)
    out.push(
      rel(`rel-${block.key}`, {
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
    out.push(
      ui
        .line("rel-subs", INDENT)
        .text_color(t.dim)
        .child(div().w(LABEL).flex_none().child("Sub-issues"))
        .child(
          div()
            .w(56)
            .h(4)
            .flex_none()
            .rounded(2)
            .bg(t.raised)
            .child(
              div()
                .h_full()
                .rounded(2)
                .bg(t.ansi2)
                .w(Math.round((56 * subs.done) / subs.total)),
            ),
        )
        .child(`${subs.done} of ${subs.total} done`),
    );
  return out;
}

function checkRow(ui, link, check) {
  const color = ui.t[CHECK[check.state]];
  return ui
    .line(`check-${link.key}-${check.name}-${check.state}`, PAD)
    .when(Boolean(check.url), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(ui.t.hover))
        .on_click(openOnly(check.url)),
    )
    .child(ui.mark(color))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .child(check.count > 1 ? `${check.name} ×${check.count}` : check.name),
    )
    .when(check.required, (el) => el.child(ui.dim("required")))
    .when(check.state !== "passed", (el) =>
      el.child(div().flex_none().text_size(11).text_color(color).child(check.state)),
    );
}
// Checks that don't need you fold into one line.
function prDetails(view, ui, link) {
  const { t } = ui,
    prData = view.prs[link.url]?.data,
    checks = checkList(prData);
  const out = [];
  const stack = stackLine(prData, [...view.vm.mine.values()], link.repo);
  if (stack)
    out.push(
      relation(ui, `stack-${link.key}`, INDENT, {
        label: "Stacked on",
        strong: Boolean(stack.mergedBase),
        color: stack.base?.merged ? t.ansi5 : t.dim,
        key: stack.base ? `#${stack.base.number}` : stack.baseName,
        title: stack.base?.title,
        state: stack.base ? (stack.base.merged ? "merged" : "open") : null,
        url: stack.base?.url,
      }),
    );
  out.push(
    ...[...readiness(prData), ...afterMerge(prData)].map((line, i) =>
      ui
        .line(`ready-${link.key}-${i}`, INDENT)
        .text_color(t[TEXT[line.tone]])
        .when(Boolean(line.url), (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(openOnly(line.url)),
        )
        .child(div().min_w(0).truncate().child(line.text)),
    ),
  );
  const labels = prData?.labels?.nodes ?? [];
  if (labels.length)
    out.push(
      h_flex()
        .flex_wrap()
        .gap(4)
        .pl(INDENT)
        .pr(PAD)
        .py(4)
        .children(
          labels.map((label) =>
            h_flex()
              .h(18)
              .px(6)
              .gap(5)
              .items_center()
              .rounded(5)
              .bg(t.raised)
              .text_size(11)
              .text_color(t.muted)
              .child(ui.dot(`#${label.color}`, 6))
              .child(label.name),
          ),
        ),
    );
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
      .line(`others-${link.key}`, PAD)
      .cursor_pointer()
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (open) view.othersOpen.delete(link.url);
        else view.othersOpen.add(link.url);
        cx.notify();
      })
      .child(ui.chevron(open))
      .child(`${count(others)} other checks${running ? ` · ${running} running` : ""}`),
  );
  if (open) out.push(...others.map((check) => checkRow(ui, link, check)));
  return out;
}

// Empty on the default branch and once the branch's PR is merged.
function branchLine(view) {
  const git = view.agent ? view.git[view.agent.cwd] : null;
  if (!isFeatureBranch(git?.branch)) return "";
  return [...view.vm.mine.values()].some((pr) => pr.branch === git.branch && pr.merged)
    ? ""
    : git.line;
}

// The agent's PR: the PR of its branch, else the first open one, else the first.
function nextLine(view, ui, github, ticketData) {
  const reviewLabel = conf().reviewLabel ?? "";
  const branch = view.agent ? view.git[view.agent.cwd]?.branch : null;
  const data = (link) => view.prs[link.url]?.data;
  const pr =
    github.find((link) => branch && view.vm.mine.get(link.url.toLowerCase())?.branch === branch) ??
    github.find((link) => data(link)?.state === "OPEN") ??
    github[0];
  const prData = pr ? data(pr) : null;
  const next = nextStep({
    pr: prData,
    stack: pr && stackLine(prData, [...view.vm.mine.values()], pr.repo),
    blocks: linearLinks(ticketData).blocks,
    issueState: ticketData?.state?.name,
    reviewLabel,
  });
  if (!next) return null;
  return h_flex()
    .id("context-next")
    .h(LINK)
    .px(PAD)
    .gap(GAP)
    .items_center()
    .rounded(7)
    .text_color(ui.t.foreground)
    .when(Boolean(next.url), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(ui.t.hover))
        .on_click(openOnly(next.url)),
    )
    .child(ui.mark(ui.t[DOT[next.tone]]))
    .child(div().min_w(0).truncate().child(next.text));
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

function sections(view, ui) {
  const { t } = ui,
    { ticket, card } = view.vm;
  const ticketLink = card.find((link) => link.kind === "issue" && link.key === ticket);
  const related = relatedKeys(view);
  const linear = card.filter(
    (link) => (link.kind === "issue" || link.kind === "doc") && !related.has(link.key),
  );
  const github = card.filter((link) => link.kind === "pr"),
    slack = card.filter((link) => link.kind === "slack");
  const rows = (list) => v_flex().gap(1).children(list);
  const line = branchLine(view);
  const slackSection = slack.length
    ? rows(slack.flatMap((link) => slackRows(view, ui, link)))
    : null;
  const branchRow = line
    ? h_flex()
        .h(LINK)
        .px(PAD)
        .gap(GAP)
        .items_center()
        .text_color(t.muted)
        .child(svg("mods/context/branch.svg").size(ICON).flex_none())
        .child(div().min_w(0).truncate().child(line))
    : null;
  const inTask = (link) => {
    const d = link.kind === "issue" ? view.issues[link.key]?.data : null;
    return relation(
      ui,
      `in-task-${link.key}`,
      INDENT,
      link.kind === "issue"
        ? {
            label: "In the task",
            color: d?.state?.color,
            key: link.key,
            title: d?.title,
            state: d?.state?.name,
            url: issueUrl(view, link),
          }
        : { label: "In the task", key: link.title, state: "doc", url: link.url },
    );
  };
  const also = linear.map((link) => (ticketLink ? inTask(link) : linkRow(view, ui, link)));
  const next = nextLine(view, ui, github, ticketLink ? view.issues[ticketLink.key]?.data : null);
  const slackFirst = card[0]?.kind === "slack";
  return [
    slackFirst ? slackSection : null,
    next ? rows([next]) : null,
    ticketLink || linear.length
      ? rows([...(ticketLink ? issueHead(view, ui, ticketLink) : []), ...also])
      : null,
    github.length || branchRow
      ? rows(
          [
            ...github.flatMap((link) => [linkRow(view, ui, link), ...prDetails(view, ui, link)]),
            branchRow,
          ].filter(Boolean),
        )
      : null,
    slackFirst ? null : slackSection,
  ].filter(Boolean);
}

// The first prompt's other links. mx/px match the card's inset.
function more(view, ui) {
  const { t } = ui,
    related = relatedKeys(view),
    list = view.vm.more.filter((link) => !related.has(link.key));
  return v_flex()
    .px(CARD + 1)
    .gap(1)
    .child(
      h_flex()
        .id("context-more")
        .h(LINK)
        .flex_none()
        .px(PAD)
        .gap(GAP)
        .items_center()
        .rounded(7)
        .cursor_pointer()
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          view.open = !view.open;
          localStorage.setItem("open", JSON.stringify(view.open));
          cx.notify();
        })
        .child(ui.chevron(view.open))
        .child(`More from the task · ${list.length}`),
    )
    .when(view.open, (el) => el.children(list.map((link) => linkRow(view, ui, link))));
}

export function panel(view, t) {
  const ui = kit(t),
    parts = sections(view, ui),
    hasMore = view.vm.more.some((link) => !relatedKeys(view).has(link.key));
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
        .px(14)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(div().font_semibold().child("Context")),
    )
    .child(
      v_flex()
        .id("context-list")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .p(6)
        .gap(6)
        .children(
          parts.map((part) =>
            part.flex_none().p(CARD).rounded(10).border_1().border_color(t.border).bg(t.surface),
          ),
        )
        .when(hasMore, (el) => el.child(more(view, ui)))
        .when(!parts.length && !hasMore, (el) =>
          el.child(div().p(8).text_size(12).text_color(t.dim).child(empty)),
        ),
    );
}
