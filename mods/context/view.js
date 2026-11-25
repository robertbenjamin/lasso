// Two edges, one rhythm. The title, section headers and cards share the outer edge (EDGE);
// everything in a card sits PAD inside it, on all four sides. Text lines are LINE high and
// rows are ROW high (LINE plus 4 above and below), so a card's text is PAD from each border.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import {
  readiness,
  linearLinks,
  checkList,
  stackLine,
  afterMerge,
  nextStep,
  withLatest,
} from "./links.js";
import { scrollToPrompt } from "./sources.js";
import {
  prLook,
  conf,
  isFeatureBranch,
  EDGE,
  GAP,
  PAD,
  SECTION,
  LINE,
  ROW,
  RADIUS,
  RADIUS_SM,
  TEXT,
  SMALL,
  tourVeil,
} from "./lib/shared.js";

const AIR = (ROW - LINE) / 2, // above and below a row's 20 px line
  HOVER = 6, // how far a row's hover reaches past its text, into the card's padding
  SLOT = 14, // a dot, logo or chevron in front of a row's text
  LABEL = 68; // the relation labels' column: "Blocked by" and "Stacked on" just fit
const BREAK = Symbol("group"); // in a card's rows: a hairline, then a new group

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
  const slot = (child) => div().w(SLOT).flex_none().flex().justify_center().child(child);
  return {
    t,
    dot,
    slot,
    mark: (color) => slot(dot(color)),
    logo: (file, color = t.muted) => svg(`mods/context/${file}.svg`).size(SLOT).text_color(color),
    chevron: (open) =>
      slot(
        svg(`mods/files/chevron-${open ? "down" : "right"}.svg`)
          .size(12)
          .text_color(t.dim),
      ),
    // Right-side text is short and says the state, so it keeps its width: the title gives way.
    small: (text, color = t.dim) =>
      div().flex_none().text_size(SMALL).text_color(color).child(text),
    fill: (child, color) =>
      div()
        .flex_auto()
        .min_w(0)
        .truncate()
        .when(Boolean(color), (el) => el.text_color(color))
        .child(child),
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
    // A row in a card. Its hover reaches HOVER past the text on both sides, so text stays put.
    row: (id, url, onClick) =>
      h_flex()
        .id(id)
        .h(ROW)
        .flex_none()
        .mx(-HOVER)
        .px(HOVER)
        .gap(GAP)
        .items_center()
        .rounded(RADIUS_SM)
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
    // Wrapped text: 20 px lines, with a row's air below.
    text: (child) => div().pb(AIR).line_height(1.5).child(child),
  };
}

// A card: groups of rows, split by hairlines that run edge to edge. With `opens`, the first
// group is one link: it lights up to the card's edges and opens that url.
function card(ui, id, rows, opens = null) {
  const groups = [[]];
  for (const row of rows.filter(Boolean))
    if (row !== BREAK) groups.at(-1).push(row);
    else if (groups.at(-1).length) groups.push([]);
  return v_flex()
    .id(id)
    .flex_none()
    .rounded(RADIUS)
    .border_1()
    .border_color(ui.t.border)
    .bg(ui.t.surface)
    .children(
      groups
        .filter((group) => group.length)
        .map((group, i) =>
          v_flex()
            .id(`${id}-group-${i}`)
            .px(PAD)
            .py(PAD - AIR)
            .children(group)
            .when(i > 0, (el) => el.border_t(1).border_color(ui.t.border))
            .when(i === 0 && Boolean(opens), (el) =>
              el
                // 1 px inside the card's border, so it nests.
                .when(groups.length > 1, (g) => g.rounded_t(RADIUS - 1))
                .when(groups.length === 1, (g) => g.rounded(RADIUS - 1))
                .cursor_pointer()
                .hover((s) => s.bg(ui.t.hover))
                .on_click((_e, cx) => openUrl(cx, opens)),
            ),
        ),
    );
}

// A source: its header (logo and name) on the outer edge, then its cards.
function section(ui, id, { icon, name, meta, onClick, cards, opens = [] }) {
  return v_flex()
    .id(id)
    .flex_none()
    .gap(GAP)
    .child(
      h_flex()
        .id(`${id}-head`)
        .gap(GAP)
        .items_center()
        .text_size(SMALL)
        .text_color(ui.t.dim)
        .when(Boolean(onClick), (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.text_color(ui.t.foreground))
            .on_click(onClick),
        )
        .child(icon)
        .child(ui.fill(name))
        .when(Boolean(meta), (el) => el.child(ui.small(meta))),
    )
    .children(cards.map((rows, i) => card(ui, `${id}-card-${i}`, rows, opens[i])));
}

// "Blocked by  ●  ABC-4398  Drop the FK": the label column fits the longest label and no
// more, so values line up close to it. An open blocker's label is lit.
function property(ui, id, { label, strong, color, key, title, url, value }) {
  return ui
    .row(id, url)
    .child(
      div()
        .w(LABEL)
        .flex_none()
        .text_size(SMALL)
        .text_color(strong ? ui.t[TONE.act] : ui.t.dim)
        .child(label),
    )
    .child(ui.slot(ui.dot(color, 6)))
    .child(value ?? ui.idTitle(key, title));
}

// A status line: a dot, then the text.
function status(ui, id, { text, tone, url }) {
  return ui
    .row(id, url)
    .child(ui.mark(ui.t[TONE[tone]]))
    .child(ui.fill(text, tone === "act" ? ui.t.foreground : ui.t.muted));
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
    .child(ui.slot(ui.logo(logo)))
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
        .row("issue")
        .child(ui.mark(d?.state?.color))
        .child(ui.fill(ticketLink.key, t.muted))
        .when(Boolean(d), (el) => el.child(ui.small(d.state?.name))),
    );
    if (d) rows.push(ui.text(d.title).font_medium());
    rows.push(BREAK);
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
        property(ui, "subs", {
          label: "Sub-issues",
          color: subs.done === subs.total ? t.ansi2 : t.dim,
          value: h_flex()
            .flex_auto()
            .gap(GAP)
            .items_center()
            .child(ui.small(`${subs.done} of ${subs.total} done`, t.muted))
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
            ),
        }),
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
  return section(ui, "linear", {
    icon: ui.logo("linear-logo"),
    name: "Linear",
    cards: [rows],
    opens: ticketLink ? [issueUrl(view, ticketLink)] : [],
  });
}

function checkRow(ui, link, check) {
  const color = ui.t[CHECK[check.state]];
  return ui
    .row(`check-${link.key}-${check.name}-${check.state}`, check.url)
    .child(ui.slot(ui.dot(color, 6)))
    .child(ui.fill(check.count > 1 ? `${check.name} ×${check.count}` : check.name, ui.t.muted))
    .when(check.required, (el) => el.child(ui.small("required")))
    .when(check.state !== "passed", (el) => el.child(ui.small(check.state, color)));
}

// One PR's card: the PR and what needs you, its labels, its checks (the quiet ones fold).
function prRows(view, ui, link) {
  const { t } = ui,
    prData = view.prs[link.url]?.data,
    pr = prOf(view, link),
    look = pr && prLook(t, pr);
  const out = [
    ui
      .row(`pr-${link.key}`)
      .child(ui.mark(look?.fill?.fg ?? t.dim))
      .child(
        pr?.title ? ui.fill(`#${link.number}`, t.muted) : ui.idTitle(`#${link.number}`, link.repo),
      )
      // Only the state word ("changes", not "changes, CI failed"): the lines below say the rest.
      .when(Boolean(look), (el) =>
        el.child(ui.small(look.label.split(",")[0], look.fill?.fg ?? t.dim)),
      ),
    // The title wraps under the number, like the Linear card's.
    pr?.title && ui.text(pr.title).font_medium(),
  ];
  // The top group is one link to the PR, so its lines don't link on their own: the next-step
  // bar above links to the exact comment or check.
  [...readiness(prData).filter((line) => line.text !== "Approved"), ...afterMerge(prData)].forEach(
    (line, i) => out.push(status(ui, `ready-${link.key}-${i}`, { ...line, url: null })),
  );
  const stack = stackLine(prData, [...view.vm.mine.values()], link.repo);
  if (stack)
    out.push(
      BREAK,
      property(ui, `stack-${link.key}`, {
        label: "Stacked on",
        strong: Boolean(stack.mergedBase),
        color: stack.base?.merged ? t.ansi5 : t.dim,
        key: stack.base ? `#${stack.base.number}` : stack.baseName,
        title: stack.base?.title,
        url: stack.base?.url,
      }),
    );
  out.push(BREAK);
  const labels = prData?.labels?.nodes ?? [];
  if (labels.length)
    out.push(
      h_flex()
        .flex_wrap()
        .gap(4)
        .py(AIR)
        .children(
          labels.map((label) =>
            h_flex()
              .h(LINE)
              .px(6)
              .gap(5)
              .items_center()
              .rounded(RADIUS_SM)
              .border_1()
              .border_color(t.border)
              .text_size(SMALL)
              .text_color(t.muted)
              .child(ui.dot(`#${label.color}`, 6))
              .child(label.name),
          ),
        ),
      BREAK,
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
      .child(ui.chevron(open))
      .child(
        ui.fill(
          `${plural(count(others), "other check")}${running ? ` · ${running} running` : ""}`,
          t.dim,
        ),
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

// The PRs, each a card; the branch is the last card's last group, or its own card.
function github(view, ui, prs) {
  const git = branchState(view);
  const branchRow =
    git &&
    ui
      .row("branch")
      .child(ui.slot(ui.logo("branch", ui.t.dim)))
      .child(ui.fill(git.branch, ui.t.muted))
      .when(Boolean(git.line), (el) => el.child(ui.small(git.line)));
  const cards = prs.map((link) => prRows(view, ui, link));
  if (branchRow) {
    if (cards.length) cards.at(-1).push(BREAK, branchRow);
    else cards.push([branchRow]);
  }
  if (!cards.length) return null;
  return section(ui, "github", {
    opens: prs.map((link) => link.url),
    icon: ui.logo(prs.length ? "github-logo" : "branch", ui.t.dim),
    name: prs.length ? "GitHub" : "Branch",
    cards,
  });
}

// Each thread a card: its author, then Haiku's summary (the first line until it answers).
function slack(view, ui, links) {
  if (!links.length) return null;
  const cards = links.map((link) => {
    const thread = view.threads[link.url],
      text = thread?.summary ?? thread?.first;
    return [
      ui
        .row(`slack-${link.key}`)
        .child(ui.fill(thread?.author ?? "Slack thread", ui.t.muted))
        .child(
          ui.small(
            [thread?.replies ? plural(thread.replies, "reply", "replies") : null, day(link.at)]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
      text ? ui.text(text) : null,
    ];
  });
  return section(ui, "slack", {
    icon: ui.logo("slack-logo", ui.t.dim),
    name: "Slack",
    cards,
    opens: links.map((link) => link.url),
  });
}

// What the agent did, then the prompts that steered the chat, the latest one lit.
function conversation(view, ui) {
  const recap = view.vm.recap;
  if (!recap?.summary) return null;
  const { t } = ui,
    today = new Date().toDateString();
  const when = (ms) =>
    !ms
      ? ""
      : new Date(ms).toDateString() === today
        ? new Date(ms).toTimeString().slice(0, 5)
        : day(ms);
  const steps = withLatest(recap.steps, view.vm.latest);
  return section(ui, "chat", {
    icon: ui.logo("chat", t.dim),
    name: "Conversation",
    cards: [
      [
        ui.text(recap.summary),
        steps.length ? BREAK : null,
        ...steps.map((step, i) => {
          const last = i === steps.length - 1;
          // A step is your prompt; a click scrolls the agent's chat to it and the reply below.
          const jump =
            step.prompt &&
            ((_e, cx) => {
              cx.stop_propagation();
              if (view.scrolling) return;
              view.scrolling = true;
              cx.spawn(async () => {
                await scrollToPrompt(view.agent.address, step);
                view.scrolling = false;
              });
            });
          return ui
            .row(`step-${i}`, null, jump || null)
            .child(ui.mark(last ? t.foreground : t.dim))
            .child(ui.fill(step.text, last ? t.foreground : t.muted))
            .child(ui.small(when(step.at)));
        }),
      ],
    ],
  });
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
  return step && card(ui, "next", [status(ui, "next-row", step)]);
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
  return section(ui, "more", {
    icon: ui.chevron(view.open),
    name: "More from the task",
    meta: String(list.length),
    onClick: (_e, cx) => {
      view.open = !view.open;
      localStorage.setItem("open", JSON.stringify(view.open));
      cx.notify();
    },
    cards: view.open ? [list.map((link) => linkRow(view, ui, link))] : [],
  });
}

function sections(view, ui) {
  const { ticket, card: links } = view.vm;
  const ticketLink = links.find((link) => link.kind === "issue" && link.key === ticket);
  const related = relatedKeys(view);
  const otherLinear = links.filter(
    (link) => (link.kind === "issue" || link.kind === "doc") && !related.has(link.key),
  );
  const prs = links.filter((link) => link.kind === "pr");
  const linearPart =
    ticketLink || otherLinear.length ? linear(view, ui, ticketLink, otherLinear) : null;
  const githubPart = github(view, ui, prs);
  const slackPart = slack(
    view,
    ui,
    links.filter((link) => link.kind === "slack"),
  );
  // The main link's source comes first.
  const sources = {
    slack: [slackPart, linearPart, githubPart],
    pr: [githubPart, linearPart, slackPart],
  }[links[0]?.kind] ?? [linearPart, githubPart, slackPart];
  const ticketData = ticketLink ? view.issues[ticketLink.key]?.data : null;
  return [
    next(view, ui, prs, ticketData),
    ...sources,
    more(view, ui),
    conversation(view, ui),
  ].filter(Boolean);
}

export function panel(view, t) {
  const ui = kit(t),
    parts = sections(view, ui);
  const empty = !view.agent
    ? "Focus an agent to see what it works on"
    : view.busy
      ? "Reading the transcript…"
      : "No linked work";
  return v_flex()
    .id("context")
    .size_full()
    .min_h(0)
    .rounded(RADIUS)
    .overflow_hidden()
    .bg(t.background)
    .border_1()
    .border_color(t.border)
    .text_color(t.foreground)
    .text_size(TEXT)
    .child(
      h_flex()
        .h(42)
        .flex_none()
        .px(EDGE)
        .gap(GAP)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(div().font_semibold().child("Context"))
        .when(Boolean(view.demo), (el) =>
          el.child(div().flex_1().text_right().text_size(SMALL).text_color(t.dim).child(view.demo)),
        ),
    )
    .child(
      v_flex()
        .id("context-list")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .p(EDGE)
        .gap(SECTION)
        .children(parts)
        .when(!parts.length, (el) =>
          el.child(div().text_size(SMALL).text_color(t.dim).child(empty)),
        ),
    )
    .children(tourVeil(t, "panel"));
}
