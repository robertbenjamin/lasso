// The Context panel's UI: panel(v, t) draws the View's state (main.js).
// The card: the "Next" answer, then one section per source (Linear, GitHub, Slack, the branch).
// One grid, so all sections line up: logos and dots in the first column (ICON wide), text in
// the second. Rows are LINK high, detail lines LINE high, relation labels LABEL wide.
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
  DEFAULT_BRANCHES,
} from "./links.js";
import { prLook, conf } from "./shared.js";

const PAD = 8; // a row's padding, from its section's 4 px inset to the first column
const ICON = 14,
  GAP = 8; // the first column, and the space before the text
const INDENT = PAD + ICON + GAP; // where the text starts in a section's rows
const LINK = 28,
  LINE = 22,
  LABEL = 72;

// Theme colors per tone and check state. Calm: a dot says the state, and nothing is red.
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

// The small parts every row uses, in the theme's colors.
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
    // A dot or chevron centered in the first column.
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
    // A Linear state: its color dot and name.
    state: (st) =>
      h_flex()
        .flex_none()
        .gap(5)
        .items_center()
        .text_size(11)
        .text_color(t.dim)
        .child(dot(st?.color))
        .child(st?.name ?? ""),
    // A detail line: LINE high, 12 px text, starting at `indent`.
    line: (id, indent) =>
      h_flex()
        .id(id)
        .h(LINE)
        .flex_none()
        .pl(indent)
        .pr(PAD)
        .gap(GAP)
        .items_center()
        .rounded(5)
        .text_size(12),
  };
}

// A relation line: "Blocked by  ● ABC-4398  Drop the FK   Done". A click opens the other item.
function relation(k, id, indent, { label, strong, color, key, title, state, url }) {
  const { t } = k;
  return k
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
        .when(Boolean(color), (el) => el.child(k.dot(color)))
        .child(div().flex_none().text_color(t.muted).child(key))
        .child(
          div()
            .flex_1()
            .min_w(0)
            .truncate()
            .child(title ?? ""),
        ),
    )
    .when(Boolean(state), (el) => el.child(k.dim(state)));
}

// A PR's chip data: GitHub's answer when we have it (fresher), else the tasks mod's list.
function prOf(v, l) {
  const g = v.prs[l.url]?.data;
  if (!g) return v.vm.mine.get(l.url.toLowerCase()) ?? null;
  return {
    title: g.title,
    merged: g.state === "MERGED",
    draft: g.isDraft,
    review: g.reviewDecision,
    ci: g.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
  };
}
// "in review, CI failed", in the color of the PR chip in the Agents list.
function prStatus(k, p) {
  if (!p) return null;
  const { label, fill } = prLook(k.t, p);
  return div()
    .flex_none()
    .text_size(11)
    .text_color(fill?.fg ?? k.t.dim)
    .child(label);
}

const issueUrl = (v, l) => l.url ?? v.issues[l.key]?.data?.url ?? null;
// One link: its source's logo, ID and title, then its state. `started`: mark a link from the task.
function linkRow(v, k, l, { started = true } = {}) {
  let source,
    label,
    meta = null,
    url = l.url;
  if (l.kind === "issue") {
    const d = v.issues[l.key]?.data;
    [source, label, url] = ["linear", k.idTitle(l.key, d?.title), issueUrl(v, l)];
    if (d) meta = k.state(d.state);
  } else if (l.kind === "pr") {
    const p = prOf(v, l);
    [source, label, meta] = [
      "github",
      k.idTitle(`#${l.number}`, p?.title ?? l.repo),
      prStatus(k, p),
    ];
  } else if (l.kind === "slack")
    [source, label, meta] = ["slack", "Slack thread", k.dim(day(l.at))];
  else [source, label, meta] = ["linear", l.title, k.dim("doc")];
  return h_flex()
    .id(`link-${l.key}`)
    .h(LINK)
    .flex_none()
    .px(PAD)
    .gap(GAP)
    .items_center()
    .rounded(7)
    .cursor_pointer()
    .hover((s) => s.bg(k.t.hover))
    .on_click((_e, cx) => {
      if (url) openUrl(cx, url);
    })
    .child(k.logo(source))
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(Boolean(meta), (el) => el.child(meta))
    .when(started && Boolean(l.start), (el) => el.child(k.dim("started")));
}

// The ticket's rows: ID and state, its title (the card's one 14 px line), then one relation
// line each for Project, Parent, Blocked by, Blocks and Sub-issues.
function issueHead(v, k, l) {
  const { t } = k,
    d = v.issues[l.key]?.data,
    url = issueUrl(v, l);
  const { blocks, subs } = linearLinks(d);
  const rel = (id, x) => relation(k, id, INDENT, x);
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
          .child(k.logo("linear"))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(l.key))
          .when(Boolean(d), (el) => el.child(k.state(d.state))),
      )
      .when(Boolean(d), (el) =>
        el.child(div().pl(INDENT).pr(PAD).pb(4).text_size(14).child(d.title)),
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
  for (const b of blocks)
    out.push(
      rel(`rel-${b.key}`, {
        label: b.blocked ? "Blocked by" : "Blocks",
        strong: b.blocked && !b.done,
        color: b.state?.color,
        key: b.key,
        title: b.title,
        state: b.state?.name,
        url: b.url,
      }),
    );
  if (subs)
    out.push(
      k
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

// One check: its state dot, name, "required" and state.
function checkRow(k, l, c) {
  const color = k.t[CHECK[c.state]];
  return k
    .line(`check-${l.key}-${c.name}-${c.state}`, PAD)
    .when(Boolean(c.url), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(k.t.hover))
        .on_click(openOnly(c.url)),
    )
    .child(k.mark(color))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .child(c.count > 1 ? `${c.name} ×${c.count}` : c.name),
    )
    .when(c.required, (el) => el.child(k.dim("required")))
    .when(c.state !== "passed", (el) =>
      el.child(div().flex_none().text_size(11).text_color(color).child(c.state)),
    );
}
// A PR's detail rows: the PR it is stacked on, what blocks it (once merged: its release and
// deploy), its labels, then the checks that need you. All other checks fold into one line.
function prDetails(v, k, l) {
  const { t } = k,
    g = v.prs[l.url]?.data,
    checks = checkList(g);
  const out = [];
  const stack = stackLine(g, [...v.vm.mine.values()], l.repo);
  if (stack)
    out.push(
      relation(k, `stack-${l.key}`, INDENT, {
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
    ...[...readiness(g), ...afterMerge(g)].map((x, i) =>
      k
        .line(`ready-${l.key}-${i}`, INDENT)
        .text_color(t[TEXT[x.tone]])
        .when(Boolean(x.url), (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(openOnly(x.url)),
        )
        .child(div().min_w(0).truncate().child(x.text)),
    ),
  );
  const labels = g?.labels?.nodes ?? [];
  if (labels.length)
    out.push(
      h_flex()
        .flex_wrap()
        .gap(4)
        .pl(INDENT)
        .pr(PAD)
        .py(2)
        .children(
          labels.map((x) =>
            h_flex()
              .h(18)
              .px(6)
              .gap(5)
              .items_center()
              .rounded(5)
              .bg(t.raised)
              .text_size(11)
              .text_color(t.muted)
              .child(k.dot(`#${x.color}`, 6))
              .child(x.name),
          ),
        ),
    );
  // A skipped check counts as passed on GitHub, so only a running or cancelled required one waits.
  const needs = (c) =>
    c.state === "failed" || (c.required && (c.state === "running" || c.state === "cancelled"));
  out.push(...checks.filter(needs).map((c) => checkRow(k, l, c)));
  const others = checks.filter((c) => !needs(c));
  if (!others.length) return out;
  const open = v.othersOpen.has(l.url),
    count = (list) => list.reduce((n, c) => n + c.count, 0);
  const running = count(others.filter((c) => c.state === "running"));
  out.push(
    k
      .line(`others-${l.key}`, PAD)
      .cursor_pointer()
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (open) v.othersOpen.delete(l.url);
        else v.othersOpen.add(l.url);
        cx.notify();
      })
      .child(k.chevron(open))
      .child(`${count(others)} other checks${running ? ` · ${running} running` : ""}`),
  );
  if (open) out.push(...others.map((c) => checkRow(k, l, c)));
  return out;
}

// The local branch's state. Empty on the default branch and once the branch's PR is merged.
function branchLine(v) {
  const g = v.agent ? v.git[v.agent.cwd] : null;
  if (!g || DEFAULT_BRANCHES.has(g.branch)) return "";
  return [...v.vm.mine.values()].some((p) => p.branch === g.branch && p.merged) ? "" : g.line;
}

// The one answer at the top of the card (nextStep()), from the agent's PR: the PR of its
// branch, else the first open one, else the first. A click opens the spot it names.
function nextLine(v, k, github, ticketData) {
  const reviewLabel = conf().reviewLabel ?? "";
  const branch = v.agent ? v.git[v.agent.cwd]?.branch : null;
  const data = (l) => v.prs[l.url]?.data;
  const pr =
    github.find((l) => branch && v.vm.mine.get(l.url.toLowerCase())?.branch === branch) ??
    github.find((l) => data(l)?.state === "OPEN") ??
    github[0];
  const g = pr ? data(pr) : null;
  const next = nextStep({
    g,
    stack: pr && stackLine(g, [...v.vm.mine.values()], pr.repo),
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
    .text_color(k.t.foreground)
    .when(Boolean(next.url), (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(k.t.hover))
        .on_click(openOnly(next.url)),
    )
    .child(k.mark(k.t[DOT[next.tone]]))
    .child(div().min_w(0).truncate().child(next.text));
}

// The card's sections: the "Next" answer, then one per source, each only when it has something.
function sections(v, k) {
  const { t } = k,
    { ticket, card } = v.vm;
  const ticketLink = card.find((l) => l.kind === "issue" && l.key === ticket);
  // Not the ticket, and not its parent or blockers: the relation lines already show them.
  const related = new Set([
    ticketLink?.key,
    v.issues[ticket]?.data?.parent?.identifier,
    ...linearLinks(v.issues[ticket]?.data).blocks.map((b) => b.key),
  ]);
  const linear = card.filter(
    (l) => (l.kind === "issue" || l.kind === "doc") && !related.has(l.key),
  );
  const github = card.filter((l) => l.kind === "pr"),
    slack = card.filter((l) => l.kind === "slack");
  const rows = (list) => v_flex().p(4).gap(1).children(list);
  const line = branchLine(v);
  // Other Linear items from the task: relation lines under a ticket, else link rows.
  const inTask = (l) => {
    const d = l.kind === "issue" ? v.issues[l.key]?.data : null;
    return relation(
      k,
      `in-task-${l.key}`,
      INDENT,
      l.kind === "issue"
        ? {
            label: "In the task",
            color: d?.state?.color,
            key: l.key,
            title: d?.title,
            state: d?.state?.name,
            url: issueUrl(v, l),
          }
        : { label: "In the task", key: l.title, state: "doc", url: l.url },
    );
  };
  const also = linear.map((l) => (ticketLink ? inTask(l) : linkRow(v, k, l)));
  const next = nextLine(v, k, github, ticketLink ? v.issues[ticketLink.key]?.data : null);
  return [
    next ? rows([next]) : null,
    ticketLink || linear.length
      ? rows([...(ticketLink ? issueHead(v, k, ticketLink) : []), ...also])
      : null,
    github.length ? rows(github.flatMap((l) => [linkRow(v, k, l), ...prDetails(v, k, l)])) : null,
    slack.length ? rows(slack.map((l) => linkRow(v, k, l))) : null,
    line
      ? rows([
          h_flex()
            .h(LINK)
            .px(PAD)
            .gap(GAP)
            .items_center()
            .text_color(t.muted)
            .child(svg("mods/context/branch.svg").size(ICON).flex_none())
            .child(div().min_w(0).truncate().child(line)),
        ])
      : null,
  ].filter(Boolean);
}

// Links mentioned later: one folded line, then the rows. mx/px match the card's inset.
function later(v, k) {
  const { t } = k,
    list = v.vm.later;
  return v_flex()
    .mx(4)
    .mt(4)
    .px(5)
    .gap(1)
    .child(
      h_flex()
        .id("context-later")
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
          v.open = !v.open;
          localStorage.setItem("open", JSON.stringify(v.open));
          cx.notify();
        })
        .child(k.chevron(v.open))
        .child(`Mentioned later · ${list.length}`),
    )
    .when(v.open, (el) => el.children(list.map((l) => linkRow(v, k, l))));
}

export function panel(v, t) {
  const k = kit(t),
    parts = sections(v, k),
    hasLater = v.vm.later.length > 0;
  const empty = !v.agent
    ? "Focus an agent to see what it works on"
    : v.busy
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
        .gap(1)
        .when(parts.length > 0, (el) =>
          el.child(
            v_flex()
              .m(4)
              .flex_none()
              .rounded(8)
              .border_1()
              .border_color(t.border)
              .bg(t.surface)
              .overflow_hidden()
              .children(parts.map((x, i) => (i ? x.border_t(1).border_color(t.border) : x))),
          ),
        )
        .when(hasLater, (el) => el.child(later(v, k)))
        .when(!parts.length && !hasLater, (el) =>
          el.child(div().p(8).text_color(t.dim).child(empty)),
        ),
    );
}
