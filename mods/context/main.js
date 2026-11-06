// Context: what the focused agent works on.
// The card: the links in the agent's first prompt (its task: a Linear issue, a PR or a Slack
// thread; also a bare ticket ID, as in "/make-pr THU-4601"), else the ticket in its branch name;
// the PR of its branch; and the PRs and Slack threads that Linear attaches to the issue. So a PR
// made later shows in the card without the agent ever printing it.
// Everything else that you or the agent mentioned later sits in a folded "Mentioned later".
// A click opens the link. Opened from the Context button in the tab bar (tasks-tabs).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, panes, focused, exec, theme, shared, layout, appHome, readTextFile } from "herdr";
import { URL_RE, parse, startLinks, readiness, branchState, linearLinks, checkList } from "./links.js";

// Copied from mods/tasks/work.js (mods can't import each other's files). The exact link from a
// Herdr terminal to its transcript: the Claude process has HC_TERMINAL_ID=<address> in its
// environment, ~/.claude/sessions/<pid>.json gives its sessionId (updated on /clear), and
// the transcript is named after the sessionId.
const TRANSCRIPT = `for f in "$HOME"/.claude/sessions/*.json; do
  grep -q '"kind":"interactive"' "$f" 2>/dev/null || continue
  pid=\${f##*/}; pid=\${pid%.json}
  ps eww -o command= -p "$pid" 2>/dev/null | tr ' ' '\\n' | grep -qx "HC_TERMINAL_ID=$1" || continue
  sid=$(grep -o '"sessionId":"[^"]*"' "$f" | cut -d'"' -f4)
  [ -n "$sid" ] && find "$HOME/.claude/projects" -name "$sid.jsonl" | head -1
  exit 0
done`;
const findTranscript = async (address) =>
  address && !address.includes("/") ? (await exec("sh", ["-c", TRANSCRIPT, "sh", address])).stdout.trim() || null : null;

// The links after byte $2 of transcript $1, size first. Only your typed prompts and the agent's
// messages: tool output and the CLAUDE.md attachment hold links of other work.
// ponytail: a line that is half written when we read it loses its links; rescan if that shows.
const SCAN = `size=$(wc -c < "$1" | tr -d ' '); echo "$size"
[ "$size" -gt "$2" ] || exit 0
tail -c +$(($2 + 1)) "$1" | head -c $((size - $2)) | grep -F -e '"message":{"role":"user","content":"' -e '"type":"assistant"' | grep -oE '${URL_RE}'`;
// The first prompts with plain text: the first one that isn't a system note is the task.
const FIRST = `grep -m 20 -F '"message":{"role":"user","content":"' "$1"`;
// For branchState(): the status header, the uncommitted count, the base, behind and ahead of
// it. Reads only, as the Changes panel (no index refresh, no lock). ponytail: no fetch, so
// "behind" is as fresh as the last fetch in that folder.
const BRANCH = `cd "$1" || exit 1
G() { git --no-optional-locks -c core.fsmonitor=false "$@"; }
s=$(G status --porcelain=v1 -b) || exit 1
printf '%s\\n' "$s" | head -1
printf '%s\\n' "$s" | tail -n +2 | grep -c .
base=$(G rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/master); echo "$base"
G rev-list --count "HEAD..$base" 2>/dev/null || echo 0
G rev-list --count "$base..HEAD" 2>/dev/null || echo 0`;
// What readiness(), checkList() and the label chips read, for PR number n.
const prFields = (n) => `title state isDraft reviewDecision mergeable baseRefName autoMergeRequest { enabledAt }
  labels(first: 20) { nodes { name color } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
  latestReviews(first: 10) { nodes { state author { login } } }
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { __typename
    ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: ${n}) }
    ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${n}) } } } } } } }`;

const TICKET = /\b([a-z]{2,6}-\d+)\b/i;
const DEFAULT_BRANCHES = new Set(["", "master", "main", "develop"]);
const CI = { SUCCESS: "ansi2", FAILURE: "ansi1", ERROR: "ansi1", PENDING: "ansi3", EXPECTED: "ansi3" };
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const shown = () => {
  const root = layout();
  const panel = find(root, "panel");
  return Boolean(panel) && !panel.hidden && find(root, "panel-body")?.active === "context";
};

// The focused terminal. A pane gives only its pane id: its terminal comes from panes(), as in
// the Changes panel.
function current() {
  const f = focused();
  const a = f?.terminal ?? (f?.pane ? panes().find((p) => p.pane === f.pane)?.terminal : null) ?? f?.agent;
  return a ? terminals().find((t) => t.address === a) ?? null : null;
}

const openUrl = (cx, url) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback; } catch { return fallback; } };

export default class Context extends View {
  init(_props, cx) {
    this.paths = {}; // address -> { path, at }
    this.scans = {}; // transcript -> { off, links }
    this.branches = {}; // cwd -> branch
    this.issues = {}; // THU-123 -> { data, at }
    this.prs = {}; // url -> { data, at }: the card's PRs from GitHub, for readiness()
    this.git = {}; // cwd -> branchState() line
    // address -> { created, links }: the task's links, kept, so /clear doesn't change the card.
    this.starts = load("starts", {});
    this.open = load("open", false);
    this.othersOpen = new Set(); // PR urls whose other checks are unfolded
    this.agent = null;
    this.ver = 0; // counts refreshes: render() builds the card again only after one
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  // Only while the panel shows: the timer, and a new agent or the panel opening (render()).
  refresh(cx, now = false) {
    const a = this.agent;
    if (this.busy || !a || (!now && !shown())) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const p = this.paths[a.address];
        if (!p || Date.now() - p.at > 60000) this.paths[a.address] = { path: await findTranscript(a.address).catch(() => null), at: Date.now() };
        const path = this.paths[a.address].path;
        if (path) { await this.start(a, path); await this.scan(path); }
        if (a.cwd && !(a.cwd in this.branches)) {
          const r = await exec("git", ["-C", a.cwd, "branch", "--show-current"]).catch(() => null);
          this.branches[a.cwd] = r?.code === 0 ? r.stdout.trim() : "";
        }
        if (a.cwd) {
          const r = await exec("sh", ["-c", BRANCH, "sh", a.cwd]).catch(() => null);
          this.git[a.cwd] = r?.code === 0 ? branchState(r.stdout.trim()) : "";
        }
        await this.linear(a);
        await this.prDetails(a);
      } finally {
        this.busy = false; this.ver++; cx.notify();
        if (this.agent !== a) this.refresh(cx); // the agent changed while we read
      }
    });
  }

  // The task's links, once per agent (an address can be used again: created tells them apart).
  async start(a, path) {
    if (this.starts[a.address]?.created === a.created_ms) return;
    const r = await exec("sh", ["-c", FIRST, "sh", path]);
    for (const line of r.stdout.split("\n")) {
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.isMeta || typeof d.message?.content !== "string") continue;
      this.starts[a.address] = { created: a.created_ms, links: startLinks(d.message.content) };
      // Agents that ended: their saved links go after 30 days.
      const live = new Set(terminals().map((t) => t.address));
      for (const [k, v] of Object.entries(this.starts)) if (!live.has(k) && Date.now() - (v.created ?? 0) > 30 * 86400000) delete this.starts[k];
      localStorage.setItem("starts", JSON.stringify(this.starts));
      return;
    }
  }

  async scan(path) {
    const s = this.scans[path] ?? (this.scans[path] = { off: 0, links: [] });
    const r = await exec("sh", ["-c", SCAN, "sh", path, String(s.off)]);
    const [size, ...urls] = r.stdout.trim().split("\n");
    if (!(+size >= s.off)) { s.off = 0; s.links = []; return; } // rewritten: start again next time
    s.off = +size;
    for (const u of urls) { const l = parse(u); if (l) s.links.push(l); }
  }

  // The ticket and every linked issue, in one call; each again after a minute at the earliest.
  async linear(a) {
    const { ticket, card, later } = this.model(a);
    const ids = [...new Set([ticket, ...[...card, ...later].filter((l) => l.kind === "issue").map((l) => l.key)])]
      .filter((id) => id && (!this.issues[id] || Date.now() - this.issues[id].at > 60000));
    if (!ids.length) return;
    this.linearKey ??= (await readTextFile(`${appHome()}/linear-key`).catch(() => "")).trim();
    if (!this.linearKey) return;
    const issue = "identifier title url state { name type color }";
    const fields = `${issue} parent { ${issue} } project { name url } attachments { nodes { url } }
      relations { nodes { type relatedIssue { ${issue} } } } inverseRelations { nodes { type issue { ${issue} } } }
      children { nodes { state { type } } }`;
    const query = `{ ${ids.map((id, i) => `i${i}: issue(id: "${id}") { ${fields} }`).join(" ")} }`;
    try {
      const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: this.linearKey, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const data = (await r.json()).data ?? {};
      ids.forEach((id, i) => { this.issues[id] = { data: data[`i${i}`] ?? null, at: Date.now() }; });
    } catch { /* offline: try again next refresh */ }
  }

  // The card's PRs from GitHub, in one call (about 0.5 s, whatever the query). Your PRs again
  // when the tasks mod's list shows a change (update time, CI, review), every minute while checks
  // run, else after 5 minutes; others' PRs after 2 minutes; merged and closed ones never.
  async prDetails(a) {
    const mine = new Map((shared("task.prs")?.list ?? []).map((p) => [p.url.toLowerCase(), p]));
    const sig = (l) => { const p = mine.get(l.url.toLowerCase()); return p ? `${p.updated}|${p.ci}|${p.review}|${p.merged}` : null; };
    const due = (l) => {
      const c = this.prs[l.url];
      if (!c) return true;
      const age = Date.now() - c.at, s = sig(l);
      if (!c.data) return age > 60000; // the last call failed
      if (s && s !== c.sig) return true;
      if (c.data?.state === "MERGED" || c.data?.state === "CLOSED") return false;
      if (["PENDING", "EXPECTED"].includes(c.data?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state)) return age > 60000;
      return age > (s ? 300000 : 120000);
    };
    const prs = this.model(a).card.filter((l) => l.kind === "pr" && due(l));
    if (!prs.length) return;
    // Owner and repo come from URL_RE: only letters, digits, "_", "." and "-".
    const query = `{ ${prs.map((l, i) => {
      const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)\/pull/.exec(l.url);
      return `p${i}: repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${l.number}) { ${prFields(l.number)} } }`;
    }).join(" ")} }`;
    const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`]).catch(() => null);
    let data = {};
    try { data = JSON.parse(r?.stdout ?? "").data ?? {}; } catch { /* gh failed: the chips from task.prs stay */ }
    prs.forEach((l, i) => { this.prs[l.url] = { at: Date.now(), sig: sig(l), data: data[`p${i}`]?.pullRequest ?? null }; });
  }

  // The card: the task's links, the branch's ticket and PR, and the issue's Linear attachments.
  // Later: the transcript's other links, newest first.
  model(a) {
    const card = new Map();
    // A bare ID that Linear doesn't know ("UTF-8", "SHA-256") is no ticket.
    const unknown = (l) => l.kind === "issue" && !l.url && this.issues[l.key] && !this.issues[l.key].data;
    const add = (l, start = false) => { if (l && !card.has(l.key) && !unknown(l)) card.set(l.key, { ...l, start }); };
    const starts = this.starts[a.address]?.created === a.created_ms ? this.starts[a.address].links : [];
    for (const l of starts) add(l, true);
    const branch = this.branches[a.cwd] ?? "";
    const ticket = starts.find((l) => l.kind === "issue")?.key ?? (TICKET.test(branch) ? TICKET.exec(branch)[1].toUpperCase() : null);
    if (ticket) add({ kind: "issue", key: ticket, url: null });
    // ponytail: matched by branch name only; two repos with the same work branch would mix.
    if (!DEFAULT_BRANCHES.has(branch)) for (const p of shared("task.prs")?.list ?? []) if (p.branch === branch) add(parse(p.url));
    for (const n of this.issues[ticket]?.data?.attachments?.nodes ?? []) add(parse(n.url));
    const later = new Map();
    for (const l of this.scans[this.paths[a.address]?.path]?.links ?? []) if (!card.has(l.key)) { later.delete(l.key); later.set(l.key, l); }
    return { ticket, card: [...card.values()], later: [...later.values()].reverse() };
  }

  render(cx) {
    const t = theme();
    // Render runs on every change in the app. So: the host's terminal lists only when the focus
    // changes (each read copies a whole list), work only while the panel shows, and the card's
    // model only after a refresh or a new PR list.
    const f = focused(), focusKey = `${f?.pane}|${f?.terminal}|${f?.agent}`;
    if (focusKey !== this.focusKey) {
      const a = current();
      this.focusKey = a ? focusKey : null; // not found yet (a new terminal): look again next time
      if (a && a.address !== this.agent?.address) { this.agent = a; this.stale = true; }
    }
    const visible = shown();
    if (visible && (this.stale || !this.wasVisible)) { this.stale = false; this.refresh(cx, true); }
    this.wasVisible = visible;
    const vmKey = `${this.ver}|${shared("task.prs")?.at}|${this.agent?.address}`;
    if (vmKey !== this.vmKey) { this.vmKey = vmKey; this.vm = this.agent ? this.model(this.agent) : { card: [], later: [] }; }
    const { ticket, card, later } = this.vm;
    const mine = new Map((shared("task.prs")?.list ?? []).map((p) => [p.url.toLowerCase(), p]));
    // GitHub's answer when we have it (fresher), else the tasks mod's list of your PRs.
    const prOf = (l) => {
      const g = this.prs[l.url]?.data;
      if (!g) return mine.get(l.url.toLowerCase()) ?? null;
      return { title: g.title, merged: g.state === "MERGED", draft: g.isDraft, review: g.reviewDecision, ci: g.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null };
    };
    const TONE = { bad: t.ansi1, good: t.ansi2, dim: t.dim };
    const ready = (l, indent = 30) => readiness(this.prs[l.url]?.data).map((x, i) =>
      div().id(`ready-${l.key}-${i}`).pl(indent).pr(8).h(18).flex_none().truncate().text_size(11).text_color(TONE[x.tone]).child(x.text));
    // Under a PR: what blocks it, its labels as chips, then the checks that need you: every
    // failing one and every required one that hasn't passed. All others are in one folded
    // section. A click on a check opens its run.
    const CHECK = { failed: t.ansi1, running: t.ansi3, passed: t.ansi2, cancelled: t.dim, skipped: t.dim };
    const checkRow = (l, c, indent) => h_flex().id(`check-${l.key}-${c.name}-${c.state}`).h(22).flex_none().pl(indent).pr(8).gap(7).items_center().rounded(5).text_size(12)
      // stop: inside the card's head, a click would also open the PR
      .when(Boolean(c.url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); openUrl(cx, c.url); }))
      .child(div().size(7).rounded(4).flex_none().bg(CHECK[c.state]))
      .child(div().flex_1().min_w(0).truncate().child(c.count > 1 ? `${c.name} ×${c.count}` : c.name))
      .when(c.required, (el) => el.child(dim("required")))
      .when(c.state !== "passed", (el) => el.child(div().flex_none().text_size(11).text_color(CHECK[c.state]).child(c.state)));
    const prExtras = (l, indent = 30) => {
      const g = this.prs[l.url]?.data, labels = g?.labels?.nodes ?? [], checks = checkList(g);
      const out = [...ready(l, indent)];
      if (labels.length) out.push(h_flex().flex_wrap().gap(4).pl(indent).pr(8).py(3).children(labels.map((x) =>
        h_flex().h(18).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_size(11).text_color(t.muted)
          .child(div().size(6).rounded(3).flex_none().bg(`#${x.color}`)).child(x.name))));
      const needs = (c) => c.state === "failed" || (c.required && c.state !== "passed");
      for (const c of checks.filter(needs)) out.push(checkRow(l, c, indent));
      const others = checks.filter((c) => !needs(c));
      if (others.length) {
        const open = this.othersOpen.has(l.url), n = (list) => list.reduce((sum, c) => sum + c.count, 0);
        const running = n(others.filter((c) => c.state === "running"));
        out.push(h_flex().id(`others-${l.key}`).h(22).flex_none().pl(indent).pr(8).gap(7).items_center().rounded(5).cursor_pointer().text_size(12).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); if (open) this.othersOpen.delete(l.url); else this.othersOpen.add(l.url); cx.notify(); })
          .child(svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none())
          .child(`${n(others)} other checks`)
          .when(running > 0, (el) => el.child(div().text_color(t.ansi3).child(`${running} running`))));
        if (open) for (const c of others) out.push(checkRow(l, c, indent + 19));
      }
      return out;
    };
    const branch = this.agent ? this.branches[this.agent.cwd] ?? "" : "";
    // A merged branch is done: its "behind master" is no news.
    const gitLine = !this.agent || DEFAULT_BRANCHES.has(branch) || (shared("task.prs")?.list ?? []).some((p) => p.branch === branch && p.merged) ? "" : this.git[this.agent.cwd] ?? "";
    const issueUrl = (l) => l.url ?? this.issues[l.key]?.data?.url ?? null;

    const dot = (color) => div().size(8).rounded(4).flex_none().bg(color ?? t.dim);
    const dim = (text) => div().flex_none().text_size(11).text_color(t.dim).child(text);
    const icon = (name, color) => svg(`mods/context/${name}.svg`).size(14).flex_none().text_color(color ?? t.muted);
    const row = (l, lead, label, meta) => h_flex().id(`link-${l.key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { const u = l.kind === "issue" ? issueUrl(l) : l.url; if (u) openUrl(cx, u); })
      .child(lead).child(div().flex_1().min_w(0).truncate().child(label))
      .when(Boolean(meta), (el) => el.child(meta)).when(Boolean(l.start), (el) => el.child(dim("started")));

    const prStatus = (p) => !p ? null : h_flex().flex_none().gap(6).items_center().text_size(11)
      .when(Boolean(p.ci) && !p.merged, (el) => el.child(div().size(7).rounded(4).bg(t[CI[p.ci]] ?? t.dim)))
      .child(div().text_color(p.merged ? t.ansi5 : p.review === "CHANGES_REQUESTED" ? t.blocked : t.dim).child(p.merged ? "merged" : p.draft ? "draft" : REVIEW[p.review] ?? "open"));
    const issueRow = (l) => {
      const d = this.issues[l.key]?.data;
      return row(l, dot(d?.state?.color), h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(l.key)).child(div().truncate().child(d?.title ?? "")), dim(d?.state?.name ?? ""));
    };
    const prRow = (l) => {
      const p = prOf(l);
      return row(l, icon("pr", p?.merged ? t.ansi5 : null), h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(`#${l.number}`)).child(div().truncate().child(p?.title ?? l.repo)), prStatus(p));
    };
    const slackRow = (l) => { const d = new Date(l.at); return row(l, icon("slack"), "Slack thread", dim(`${d.getDate()} ${MONTHS[d.getMonth()]}`)); };
    const docRow = (l) => row(l, icon("doc"), l.title, null);
    const ROWS = { issue: issueRow, pr: prRow, slack: slackRow, doc: docRow };

    // The card's head: the issue, else the task's PR, else its Slack thread or doc.
    const head = card.find((l) => l.key === ticket) ?? card.find((l) => l.kind === "pr") ?? card[0];
    // Under the issue: what blocks it and what it blocks (an open blocker in the "blocked"
    // color), and how many sub-issues are done.
    const blockRows = (d) => {
      const { blocks, subs } = linearLinks(d);
      return [
        ...blocks.map((b) => h_flex().id(`block-${b.key}`).gap(6).min_w(0).text_size(12).text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); if (b.url) openUrl(cx, b.url); })
          .child(div().flex_none().text_color(b.blocked && !b.done ? t.blocked : t.dim).child(b.blocked ? "Blocked by" : "Blocks"))
          .child(dot(b.state?.color)).child(div().flex_none().child(b.key)).child(div().flex_1().min_w(0).truncate().child(b.title ?? ""))
          .child(dim(b.state?.name ?? ""))),
        ...(subs ? [div().text_size(12).text_color(t.dim).child(`Sub-issues ${subs.done}/${subs.total} done`)] : []),
      ];
    };
    const headView = () => {
      const top = (lead, id, state) => h_flex().gap(7).items_center().text_size(12).child(lead).child(div().text_color(t.muted).child(id)).child(div().flex_1()).child(state ?? div());
      if (head.kind === "issue") {
        const d = this.issues[head.key]?.data;
        return v_flex().gap(5)
          .child(top(dot(d?.state?.color), head.key, div().text_color(t.dim).child(d?.state?.name ?? "")))
          .when(Boolean(d), (el) => el.child(div().font_semibold().child(d.title)))
          .when(Boolean(d?.parent), (el) => el.child(h_flex().id("context-parent").gap(6).min_w(0).text_size(12).text_color(t.muted).hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); openUrl(cx, d.parent.url); })
            .child("↳").child(dot(d.parent.state?.color)).child(div().flex_none().child(d.parent.identifier)).child(div().truncate().child(d.parent.title))))
          .when(Boolean(d?.project), (el) => el.child(div().text_size(12).text_color(t.dim).truncate().child(d.project.name)))
          .children(blockRows(d));
      }
      if (head.kind === "pr") {
        const p = prOf(head);
        return v_flex().gap(5).child(top(icon("pr", p?.merged ? t.ansi5 : null), `${head.repo} #${head.number}`, prStatus(p)))
          .when(Boolean(p?.title), (el) => el.child(div().font_semibold().child(p.title)))
          .children(prExtras(head, 16));
      }
      if (head.kind === "slack") { const d = new Date(head.at); return v_flex().child(top(icon("slack"), `Slack thread · ${d.getDate()} ${MONTHS[d.getMonth()]}`, null)); }
      return v_flex().child(top(icon("doc"), head.title, null));
    };
    const cardView = () => {
      const rest = card.filter((l) => l !== head);
      return v_flex().m(4).flex_none().rounded(8).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
        .when(Boolean(head), (el) => el.child(div().id("context-head").p(10).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { const u = head.kind === "issue" ? issueUrl(head) : head.url; if (u) openUrl(cx, u); })
          .child(headView())))
        .when(rest.length > 0, (el) => el.child(v_flex().p(4).gap(1).border_t(1).border_color(t.border)
          .children(rest.flatMap((l) => l.kind === "pr" ? [prRow(l), ...prExtras(l)] : [ROWS[l.kind](l)]))))
        .when(Boolean(gitLine), (el) => el.child(h_flex().h(30).px(12).gap(8).items_center().text_size(12).text_color(t.muted)
          .when(Boolean(head) || rest.length > 0, (e) => e.border_t(1).border_color(t.border))
          .child(icon("branch")).child(div().min_w(0).truncate().child(gitLine))));
    };

    const laterView = () => [
      h_flex().id("context-later").h(28).flex_none().mx(4).mt(4).px(6).gap(6).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.open = !this.open; localStorage.setItem("open", JSON.stringify(this.open)); cx.notify(); })
        .child(svg(`mods/files/chevron-${this.open ? "down" : "right"}.svg`).size(12).flex_none())
        .child("Mentioned later").child(String(later.length)),
      ...(this.open ? later.map((l) => ROWS[l.kind](l)) : []),
    ];

    const empty = !this.agent ? "Focus an agent to see what it works on" : this.busy && !card.length && !later.length ? "Reading the transcript…" : "No linked work";
    return v_flex().id("context").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Context")))
      .child(v_flex().id("context-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .when(Boolean(head) || Boolean(gitLine), (el) => el.child(cardView()))
        .when(later.length > 0, (el) => el.children(laterView()))
        .when(!head && !gitLine && !later.length, (el) => el.child(div().p(8).text_color(t.dim).child(empty))));
  }
}
