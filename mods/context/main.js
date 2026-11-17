// The Context panel: what the focused agent works on.
// The card: the links in the agent's first prompt (else the ticket in its branch name), the PR
// of its branch, and what Linear attaches to the ticket. Other links go under "Mentioned later".
//
// main.js: state and when to read. sources.js: the reads. view.js: the UI.
// links.js: the pure rules (test: node links.check.mjs).
import { View } from "gpui-kit";
import { terminals, panes, focused, theme, shared, layout } from "herdr";
import { parse, DEFAULT_BRANCHES, deployFinal } from "./links.js";
import { readStart, scanFrom, readBranch, fetchIssues, fetchPrs } from "./sources.js";
import { panel } from "./view.js";
import { find } from "./shared.js";

const TICKET = /\b([a-z]{2,6}-\d+)\b/i;
const MINUTE = 60000;

const shown = () => {
  const root = layout(), panel = find(root, "panel");
  return Boolean(panel) && !panel.hidden && find(root, "panel-body")?.active === "context";
};
// The focused terminal. A focused pane gives only its pane id.
function current() {
  const f = focused();
  const a = f?.terminal ?? (f?.pane ? panes().find((p) => p.pane === f.pane)?.terminal : null) ?? f?.agent;
  return a ? terminals().find((t) => t.address === a) ?? null : null;
}
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback; } catch { return fallback; } };
// From the tasks mod. The transcript is null for other programs, other machines and an agent
// started in the last minute.
const transcriptOf = (a) => (shared("task.transcripts") ?? {})[a.address] ?? null;
const yourPrs = () => shared("task.prs")?.list ?? [];

export default class Context extends View {
  init(_props, cx) {
    this.scans = {}; // transcript -> { off, links }
    this.git = {}; // cwd -> { branch, line }
    this.issues = {}; // ABC-123 -> { data, at }
    this.prs = {}; // url -> { data, at, sig }: the card's PRs from GitHub
    // address -> { created, links }: the task's links, saved, so /clear doesn't change the card.
    this.starts = load("starts", {});
    this.open = load("open", false); // "Mentioned later" unfolded
    this.othersOpen = new Set(); // PR urls whose other checks are unfolded
    this.agent = null;
    this.ver = 0; // counts refreshes
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  // Reads only while the panel shows. `now`: also when it doesn't (it is just opening).
  refresh(cx, now = false) {
    const a = this.agent;
    if (this.busy || !a || (!now && !shown())) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const path = transcriptOf(a);
        if (path) { await this.start(a, path); await this.scan(path); }
        if (a.cwd) this.git[a.cwd] = (await readBranch(a.cwd)) ?? { branch: "", line: "" };
        await this.linear(a);
        await this.github(a);
      } finally {
        this.busy = false; this.ver++; cx.notify();
        if (this.agent !== a) this.refresh(cx); // the agent changed while we read
      }
    });
  }

  // The task's links, once per agent. Addresses are reused: created_ms tells agents apart.
  async start(a, path) {
    if (this.starts[a.address]?.created === a.created_ms) return;
    const links = await readStart(path);
    if (!links) return;
    this.starts[a.address] = { created: a.created_ms, links };
    // Ended agents' links go after 30 days.
    const live = new Set(terminals().map((t) => t.address));
    for (const [k, v] of Object.entries(this.starts)) if (!live.has(k) && Date.now() - (v.created ?? 0) > 30 * 86400000) delete this.starts[k];
    localStorage.setItem("starts", JSON.stringify(this.starts));
  }

  // Only the bytes added since the last scan.
  async scan(path) {
    const s = this.scans[path] ?? (this.scans[path] = { off: 0, links: [] });
    const { size, links } = await scanFrom(path, s.off);
    if (!(size >= s.off)) { s.off = 0; s.links = []; return; } // written again: start over next time
    s.off = size;
    s.links.push(...links);
  }

  // The ticket and every linked issue in one call, each at most once a minute.
  async linear(a) {
    const { ticket, card, later } = this.model(a);
    const ids = [...new Set([ticket, ...[...card, ...later].filter((l) => l.kind === "issue").map((l) => l.key)])]
      .filter((id) => id && (!this.issues[id] || Date.now() - this.issues[id].at > MINUTE));
    if (!ids.length) return;
    const got = await fetchIssues(ids);
    if (got) ids.forEach((id, i) => { this.issues[id] = { data: got[i], at: Date.now() }; });
  }

  // The card's PRs, each read again when due (see `due`).
  async github(a) {
    const mine = new Map(yourPrs().map((p) => [p.url.toLowerCase(), p]));
    const sig = (l) => { const p = mine.get(l.url.toLowerCase()); return p ? `${p.updated}|${p.ci}|${p.review}|${p.merged}|${p.draft}` : null; };
    const due = (l) => {
      const c = this.prs[l.url];
      if (!c) return true;
      const age = Date.now() - c.at, s = sig(l);
      if (!c.data) return age > MINUTE; // the last call failed
      if (s && s !== c.sig) return true; // the tasks mod's list shows a change
      if (c.data.state === "MERGED") return !deployFinal(c.data) && age > MINUTE; // until deployed
      if (c.data.state === "CLOSED") return false;
      const checksRun = ["PENDING", "EXPECTED"].includes(c.data.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state);
      return age > (checksRun ? MINUTE : s ? 5 * MINUTE : 2 * MINUTE); // yours 5 min, others' 2
    };
    const prs = this.model(a).card.filter((l) => l.kind === "pr" && due(l));
    if (!prs.length) return;
    const got = await fetchPrs(prs);
    prs.forEach((l, i) => { this.prs[l.url] = { at: Date.now(), sig: sig(l), data: got[i] }; });
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
    const branch = this.git[a.cwd]?.branch ?? "";
    const ticket = starts.find((l) => l.kind === "issue")?.key ?? (TICKET.test(branch) ? TICKET.exec(branch)[1].toUpperCase() : null);
    if (ticket) add({ kind: "issue", key: ticket, url: null });
    // ponytail: matched by branch name only; two repos with the same work branch would mix.
    if (!DEFAULT_BRANCHES.has(branch)) for (const p of yourPrs()) if (p.branch === branch) add(parse(p.url));
    for (const n of this.issues[ticket]?.data?.attachments?.nodes ?? []) add(parse(n.url));
    const later = new Map();
    for (const l of this.scans[transcriptOf(a)]?.links ?? []) if (!card.has(l.key)) { later.delete(l.key); later.set(l.key, l); }
    return { ticket, card: [...card.values()], later: [...later.values()].reverse() };
  }

  // Render runs on every change in the app, so it does little: it looks up the agent only when
  // the focus changes, and builds the model only after a refresh or a new PR list.
  render(cx) {
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
    if (vmKey !== this.vmKey) {
      this.vmKey = vmKey;
      const mine = new Map(yourPrs().map((p) => [p.url.toLowerCase(), p]));
      this.vm = { ...(this.agent ? this.model(this.agent) : { ticket: null, card: [], later: [] }), mine };
    }
    return panel(this, theme());
  }
}
