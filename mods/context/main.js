// Context: what the focused agent works on. Opened from the Context button in the tab bar
// (tasks-tabs), in the panel stack "panel-body".
// The card: the links in the agent's first prompt (its task: a Linear issue, a PR or a Slack
// thread; also a bare ticket ID, as in "/make-pr THU-4601"), else the ticket in its branch name;
// the PR of its branch; and the PRs and Slack threads that Linear attaches to the issue. So a PR
// made later shows in the card without the agent ever printing it. Everything else that you or
// the agent mentioned later sits in a folded "Mentioned later".
//
// main.js: the state, when to read, and the card's model. sources.js: the reads (transcript,
// git, Linear, GitHub). view.js: the UI. links.js: the pure rules, tested by links.check.mjs.
import { View } from "gpui-kit";
import { terminals, panes, focused, theme, shared, layout } from "herdr";
import { parse, DEFAULT_BRANCHES } from "./links.js";
import { findTranscript, readStart, scanFrom, readBranch, fetchIssues, fetchPrs } from "./sources.js";
import { panel } from "./view.js";

const TICKET = /\b([a-z]{2,6}-\d+)\b/i;
const MINUTE = 60000;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const shown = () => {
  const root = layout(), panel = find(root, "panel");
  return Boolean(panel) && !panel.hidden && find(root, "panel-body")?.active === "context";
};
// The focused terminal. A pane gives only its pane id: its terminal comes from panes(), as in
// the Changes panel.
function current() {
  const f = focused();
  const a = f?.terminal ?? (f?.pane ? panes().find((p) => p.pane === f.pane)?.terminal : null) ?? f?.agent;
  return a ? terminals().find((t) => t.address === a) ?? null : null;
}
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback; } catch { return fallback; } };
const yourPrs = () => shared("task.prs")?.list ?? []; // the tasks mod's list of your PRs, every minute

export default class Context extends View {
  init(_props, cx) {
    this.paths = {}; // address -> { path, at }: the agent's transcript
    this.scans = {}; // transcript -> { off, links }
    this.git = {}; // cwd -> { branch, line }
    this.issues = {}; // THU-123 -> { data, at }
    this.prs = {}; // url -> { data, at, sig }: the card's PRs from GitHub
    // address -> { created, links }: the task's links, kept, so /clear doesn't change the card.
    this.starts = load("starts", {});
    this.open = load("open", false); // "Mentioned later" unfolded
    this.othersOpen = new Set(); // PR urls whose other checks are unfolded
    this.agent = null;
    this.ver = 0; // counts refreshes: render() builds the model again only after one
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
        if (!p || Date.now() - p.at > MINUTE) this.paths[a.address] = { path: await findTranscript(a.address).catch(() => null), at: Date.now() };
        const path = this.paths[a.address].path;
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

  // The task's links, once per agent (an address can be used again: created tells them apart).
  async start(a, path) {
    if (this.starts[a.address]?.created === a.created_ms) return;
    const links = await readStart(path);
    if (!links) return;
    this.starts[a.address] = { created: a.created_ms, links };
    // Agents that ended: their saved links go after 30 days.
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

  // The ticket and every linked issue, in one call; each again after a minute at the earliest.
  async linear(a) {
    const { ticket, card, later } = this.model(a);
    const ids = [...new Set([ticket, ...[...card, ...later].filter((l) => l.kind === "issue").map((l) => l.key)])]
      .filter((id) => id && (!this.issues[id] || Date.now() - this.issues[id].at > MINUTE));
    if (!ids.length) return;
    const got = await fetchIssues(ids);
    if (got) ids.forEach((id, i) => { this.issues[id] = { data: got[i], at: Date.now() }; });
  }

  // The card's PRs. Yours again when the tasks mod's list shows a change (update time, CI,
  // review), every minute while checks run, else after 5 minutes; others' PRs after 2 minutes;
  // merged and closed ones never; a failed call after a minute.
  async github(a) {
    const mine = new Map(yourPrs().map((p) => [p.url.toLowerCase(), p]));
    const sig = (l) => { const p = mine.get(l.url.toLowerCase()); return p ? `${p.updated}|${p.ci}|${p.review}|${p.merged}` : null; };
    const due = (l) => {
      const c = this.prs[l.url];
      if (!c) return true;
      const age = Date.now() - c.at, s = sig(l);
      if (!c.data) return age > MINUTE;
      if (s && s !== c.sig) return true;
      if (c.data.state === "MERGED" || c.data.state === "CLOSED") return false;
      if (["PENDING", "EXPECTED"].includes(c.data.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state)) return age > MINUTE;
      return age > (s ? 5 * MINUTE : 2 * MINUTE);
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
    for (const l of this.scans[this.paths[a.address]?.path]?.links ?? []) if (!card.has(l.key)) { later.delete(l.key); later.set(l.key, l); }
    return { ticket, card: [...card.values()], later: [...later.values()].reverse() };
  }

  // Render runs on every change in the app. So: the host's terminal lists only when the focus
  // changes (each read copies a whole list), work only while the panel shows, and the model only
  // after a refresh or a new PR list.
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
