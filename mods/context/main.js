// Context: the links of the focused agent's family (its root parent and all its children).
// At the top, the family's Linear ticket as a card (from a branch name, else the first Linear
// link). Below it, the Linear issues and docs, PRs and Slack threads that you pasted or the
// agents wrote, from their Claude Code transcripts. A click opens the link.
// Opened from the Context button in the tab bar (tasks-tabs), in the panel stack ("panel-body").
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, panes, focused, exec, theme, shared, layout, appHome, readTextFile } from "herdr";

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

const URL_RE = String.raw`https://(linear\.app/[a-z0-9-]+/(issue|project|document)/[A-Za-z0-9-]+|github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+|[a-z0-9-]+\.slack\.com/archives/[A-Z0-9]+/p[0-9]+)`;
// The links after byte $2 of transcript $1, size first. Only your typed prompts and the agent's
// messages: tool output and the CLAUDE.md attachment hold links of other work.
// ponytail: a line that is half written when we read it loses its links; rescan if that shows.
const SCAN = `size=$(wc -c < "$1" | tr -d ' '); echo "$size"
[ "$size" -gt "$2" ] || exit 0
tail -c +$(($2 + 1)) "$1" | head -c $((size - $2)) | grep -F -e '"message":{"role":"user","content":"' -e '"type":"assistant"' | grep -oE '${URL_RE}'`;

const TICKET = /\b([a-z]{2,6}-\d+)\b/i;
const CI = { SUCCESS: "ansi2", FAILURE: "ansi1", ERROR: "ansi1", PENDING: "ansi3", EXPECTED: "ansi3" };
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parse(url) {
  let m;
  if ((m = /^(https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z]+-\d+))/.exec(url))) return { kind: "issue", key: m[2].toUpperCase(), url: m[1] };
  if ((m = /linear\.app\/[^/]+\/(?:project|document)\/(.+)$/.exec(url))) {
    const name = m[1].replace(/-[0-9a-f]{8,}$/, "").replace(/-/g, " ");
    return { kind: "doc", key: url, url, title: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  if ((m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url))) return { kind: "pr", key: `${m[1]}/${m[2]}#${m[3]}`.toLowerCase(), url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`, repo: m[2], number: +m[3] };
  if ((m = /\/archives\/[A-Z0-9]+\/p(\d{10})\d{6}/.exec(url))) return { kind: "slack", key: url, url, at: +m[1] * 1000 };
  return null;
}

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

// The focused terminal's root parent, then all its children, breadth first.
function family() {
  const all = terminals(), by = new Map(all.map((t) => [t.address, t]));
  const f = focused();
  // A pane gives only its pane id: its terminal comes from panes(), as in the Changes panel.
  let a = f?.terminal ?? (f?.pane ? panes().find((p) => p.pane === f.pane)?.terminal : null) ?? f?.agent;
  if (!a || !by.has(a)) return null;
  while (by.get(a).parent && by.has(by.get(a).parent)) a = by.get(a).parent;
  const out = [], queue = [a];
  while (queue.length) {
    const x = queue.shift();
    out.push(by.get(x));
    for (const t of all) if (t.parent === x) queue.push(t.address);
  }
  return out;
}

const openUrl = (cx, url) => cx.spawn(async () => { await exec("open", [url]).catch(() => null); });

export default class Context extends View {
  init(_props, cx) {
    this.paths = {}; // address -> { path, at }
    this.scans = {}; // transcript -> { off, links }
    this.branches = {}; // cwd -> branch
    this.issues = {}; // THU-123 -> { data, at }
    this.fam = null;
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  // The timer reads only while the panel shows; a new family is read at once, shown or not.
  refresh(cx, now = false) {
    if (this.busy || !this.fam || (!now && !shown())) return;
    const fam = this.fam;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        for (const m of fam) {
          const p = this.paths[m.address];
          if (!p || Date.now() - p.at > 60000) this.paths[m.address] = { path: await findTranscript(m.address).catch(() => null), at: Date.now() };
          const path = this.paths[m.address].path;
          if (path) await this.scan(path);
          if (m.cwd && !(m.cwd in this.branches)) {
            const r = await exec("git", ["-C", m.cwd, "branch", "--show-current"]).catch(() => null);
            this.branches[m.cwd] = r?.code === 0 ? r.stdout.trim() : "";
          }
        }
        await this.linear(fam);
      } finally {
        this.busy = false; cx.notify();
        if (this.fam !== fam) this.refresh(cx, true); // the family changed while we read
      }
    });
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
  async linear(fam) {
    const { ticket, links } = this.model(fam);
    const ids = [...new Set([ticket, ...links.filter((l) => l.kind === "issue").map((l) => l.key)])]
      .filter((id) => id && (!this.issues[id] || Date.now() - this.issues[id].at > 60000));
    if (!ids.length) return;
    this.linearKey ??= (await readTextFile(`${appHome()}/linear-key`).catch(() => "")).trim();
    if (!this.linearKey) return;
    const fields = "identifier title url state { name color } parent { identifier title url state { name color } } project { name url } attachments { nodes { url } }";
    const query = `{ ${ids.map((id, i) => `i${i}: issue(id: "${id}") { ${fields} }`).join(" ")} }`;
    try {
      const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: this.linearKey, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const data = (await r.json()).data ?? {};
      ids.forEach((id, i) => { this.issues[id] = { data: data[`i${i}`] ?? null, at: Date.now() }; });
    } catch { /* offline: try again next refresh */ }
  }

  // Every link once, newest first, with the agents that mentioned it; the ticket's Linear
  // attachments (PRs, Slack threads) count as mentioned by "Linear".
  model(fam) {
    const links = new Map();
    const add = (l, from) => {
      const x = links.get(l.key) ?? { ...l, from: new Set() };
      x.from.add(from);
      links.delete(l.key); links.set(l.key, x);
    };
    for (const m of fam) for (const l of this.scans[this.paths[m.address]?.path]?.links ?? []) add(l, m.address);
    const branch = fam.map((m) => this.branches[m.cwd] ?? "").find((b) => TICKET.test(b));
    const ticket = branch ? TICKET.exec(branch)[1].toUpperCase() : [...links.values()].find((l) => l.kind === "issue")?.key;
    for (const a of this.issues[ticket]?.data?.attachments?.nodes ?? []) { const l = parse(a.url); if (l) add(l, "Linear"); }
    return { ticket, links: [...links.values()].reverse() };
  }

  render(cx) {
    const t = theme();
    const fam = family();
    if (fam) {
      const key = fam.map((m) => m.address).join(",");
      if (key !== this.famKey) { this.famKey = key; this.fam = fam; this.refresh(cx, true); }
    }
    const { ticket, links } = this.fam ? this.model(this.fam) : { links: [] };
    const several = (this.fam?.length ?? 0) > 1;
    const prs = new Map((shared("task.prs")?.list ?? []).map((p) => [p.url.toLowerCase(), p]));
    const group = (kind) => links.filter((l) => l.kind === kind && l.key !== ticket);

    const dot = (color) => div().size(8).rounded(4).flex_none().bg(color ?? t.dim);
    const from = (l) => div().flex_none().text_size(11).text_color(t.dim).child([...l.from].join(" "));
    const row = (l, icon, label, meta) => h_flex().id(`link-${l.key}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => openUrl(cx, l.url)).tooltip(l.url)
      .child(icon).child(div().flex_1().min_w(0).truncate().child(label))
      .when(Boolean(meta), (el) => el.child(meta)).when(several, (el) => el.child(from(l)));
    const section = (label, items) => items.length ? [h_flex().h(24).flex_none().px(8).pt(6).gap(6).items_center().text_size(11).text_color(t.dim)
      .child(label).child(String(items.length)), ...items] : [];

    const issue = (l) => {
      const d = this.issues[l.key]?.data;
      return row(l, dot(d?.state?.color), h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(l.key)).child(div().truncate().child(d?.title ?? "")),
        div().flex_none().text_size(11).text_color(t.dim).child(d?.state?.name ?? ""));
    };
    const pr = (l) => {
      const p = prs.get(l.url.toLowerCase());
      const status = !p ? null : h_flex().flex_none().gap(6).items_center().text_size(11)
        .when(Boolean(p.ci) && !p.merged, (el) => el.child(div().size(7).rounded(4).bg(t[CI[p.ci]] ?? t.dim)))
        .child(div().text_color(p.merged ? t.ansi5 : p.review === "CHANGES_REQUESTED" ? t.blocked : t.dim).child(p.merged ? "merged" : p.draft ? "draft" : REVIEW[p.review] ?? "open"));
      return row(l, svg("mods/context/pr.svg").size(14).flex_none().text_color(p?.merged ? t.ansi5 : t.muted),
        h_flex().gap(6).min_w(0).child(div().flex_none().text_color(t.muted).child(`#${l.number}`)).child(div().truncate().child(p?.title ?? l.repo)), status);
    };
    const slack = (l) => {
      const d = new Date(l.at);
      return row(l, svg("mods/context/slack.svg").size(14).flex_none().text_color(t.muted), "Slack thread",
        div().flex_none().text_size(11).text_color(t.dim).child(`${d.getDate()} ${MONTHS[d.getMonth()]}`));
    };
    const doc = (l) => row(l, svg("mods/context/doc.svg").size(14).flex_none().text_color(t.muted), l.title, null);

    const card = () => {
      const d = this.issues[ticket]?.data, url = d?.url ?? `https://linear.app/issue/${ticket}`;
      return v_flex().id("context-card").m(4).p(10).gap(5).flex_none().rounded(8).border_1().border_color(t.border).bg(t.surface).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => openUrl(cx, url))
        .child(h_flex().gap(7).items_center().text_size(12)
          .child(dot(d?.state?.color)).child(div().text_color(t.muted).child(ticket)).child(div().flex_1())
          .child(div().text_color(t.dim).child(d?.state?.name ?? "")))
        .when(Boolean(d), (el) => el.child(div().font_semibold().child(d.title)))
        .when(Boolean(d?.parent), (el) => el.child(h_flex().id("context-parent").gap(6).min_w(0).text_size(12).text_color(t.muted).rounded(5).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); openUrl(cx, d.parent.url); })
          .child("↳").child(dot(d.parent.state?.color)).child(div().flex_none().child(d.parent.identifier)).child(div().truncate().child(d.parent.title))))
        .when(Boolean(d?.project), (el) => el.child(div().text_size(12).text_color(t.dim).truncate().child(d.project.name)));
    };

    const body = [
      ...(ticket ? [card()] : []),
      ...section("Linear", group("issue").map(issue)),
      ...section("Pull requests", group("pr").map(pr)),
      ...section("Slack", group("slack").map(slack)),
      ...section("Docs", group("doc").map(doc)),
    ];
    const empty = !this.fam ? "Focus an agent to see its links" : this.busy && !body.length ? "Reading transcripts…" : "No links yet";
    return v_flex().id("context").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Context"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${links.length} ${links.length === 1 ? "link" : "links"}`))
        .child(div().flex_1())
        .when(several, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${this.fam.length} agents`))))
      .child(v_flex().id("context-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .children(body).when(!body.length, (el) => el.child(div().p(8).text_color(t.dim).child(empty))));
  }
}
