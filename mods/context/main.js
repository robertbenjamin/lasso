// The Context panel: what the focused agent works on. main.js holds the state and decides when
// to read; sources.js reads; view.js draws; links.js has the pure rules.
import { View } from "gpui-kit";
import { terminals, panes, focused, theme, shared, layout } from "herdr";
import { parse, deployFinal, slackTs, parseThread } from "./links.js";
import { readStart, readThread, summarize, readBranch, fetchIssues, fetchPrs } from "./sources.js";
import { panel } from "./view.js";
import { demoView } from "./demo.js";
import { find, loadConf, TICKET, prsOnBranch, worktreeRepo } from "./lib/shared.js";

const MINUTE = 60000,
  MONTH = 30 * 86400000;

const shown = () => {
  const root = layout(),
    panelNode = find(root, "panel");
  return Boolean(panelNode) && !panelNode.hidden && find(root, "panel-body")?.active === "context";
};

// A focused pane gives only its pane id.
function focusedTerminal() {
  const focus = focused();
  const paneTerminal = focus?.pane
    ? panes().find((pane) => pane.pane === focus.pane)?.terminal
    : null;
  const address = focus?.terminal ?? paneTerminal ?? focus?.agent;
  return address ? (terminals().find((terminal) => terminal.address === address) ?? null) : null;
}

const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
};

const transcriptOf = (agent) => (shared("task.transcripts") ?? {})[agent.address] ?? null;
const yourPrs = () => shared("task.prs")?.list ?? [];

export default class Context extends View {
  init(props, cx) {
    if (props?.demo) {
      this.fixture = demoView(props.demo);
      return;
    }
    this.git = {}; // cwd -> { branch, line }
    this.issues = {}; // ABC-123 -> { data, at }
    this.prs = {}; // url -> { data, at, sig }
    // Saved, so /clear doesn't change the card. address -> { created, links }
    this.starts = load("starts", {});
    this.threads = load("threads", {}); // Slack url -> { at, author, first, replies, summary }
    this.open = load("open", false);
    this.othersOpen = new Set();
    this.agent = null;
    this.ver = 0;
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  // Reads only while the panel shows, unless `now` (it is just opening).
  refresh(cx, now = false) {
    const agent = this.agent;
    if (this.busy || !agent || (!now && !shown())) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await loadConf();
        const path = transcriptOf(agent);
        if (path) await this.start(agent, path);
        if (agent.cwd)
          this.git[agent.cwd] = (await readBranch(agent.cwd)) ?? { branch: "", line: "" };
        // Show the branch and PR chips now; the ticket and the checks come after.
        this.ver++;
        cx.notify();
        await this.linear(agent);
        await this.github(agent);
        if (path) await this.slack(agent, path, cx);
      } finally {
        this.busy = false;
        this.ver++;
        cx.notify();
        if (this.agent !== agent) this.refresh(cx);
      }
    });
  }

  // Addresses are reused, so created_ms tells agents apart.
  async start(agent, path) {
    if (this.starts[agent.address]?.created === agent.created_ms) return;
    const links = await readStart(path);
    if (!links) return;
    this.starts[agent.address] = { created: agent.created_ms, links };
    const live = new Set(terminals().map((terminal) => terminal.address));
    for (const [address, start] of Object.entries(this.starts))
      if (!live.has(address) && Date.now() - (start.created ?? 0) > MONTH)
        delete this.starts[address];
    localStorage.setItem("starts", JSON.stringify(this.starts));
  }

  // The card's Slack threads that the agent read: their first line now, Haiku's summary after.
  // shortcut: a thread is read once, so later replies don't show; read it again if that matters.
  async slack(agent, path, cx) {
    const todo = this.model(agent).card.filter(
      (link) => link.kind === "slack" && this.threads[link.url]?.summary === undefined,
    );
    for (const link of todo) {
      const text = await readThread(path, slackTs(link.url));
      if (!text) continue;
      this.threads[link.url] = { at: Date.now(), ...parseThread(text) };
      this.ver++;
      cx.notify();
      // null: Haiku failed. It isn't asked again, so a broken `claude` doesn't run every 15 s.
      this.threads[link.url].summary = await summarize(text);
      for (const [url, thread] of Object.entries(this.threads))
        if (Date.now() - thread.at > MONTH) delete this.threads[url];
      localStorage.setItem("threads", JSON.stringify(this.threads));
    }
  }

  async linear(agent) {
    const { ticket, card, more } = this.model(agent);
    const issueKeys = [...card, ...more]
      .filter((link) => link.kind === "issue")
      .map((link) => link.key);
    const ids = [...new Set([ticket, ...issueKeys])].filter(
      (id) => id && (!this.issues[id] || Date.now() - this.issues[id].at > MINUTE),
    );
    if (!ids.length) return;
    const got = await fetchIssues(ids);
    if (got)
      ids.forEach((id, i) => {
        this.issues[id] = { data: got[i], at: Date.now() };
      });
  }

  async github(agent) {
    const mine = new Map(yourPrs().map((pr) => [pr.url.toLowerCase(), pr]));
    // The tasks mod refreshes your PRs often: a change there means this PR changed too.
    const signature = (link) => {
      const pr = mine.get(link.url.toLowerCase());
      return pr ? `${pr.updated}|${pr.ci}|${pr.review}|${pr.merged}|${pr.draft}` : null;
    };
    const due = (link) => {
      const cached = this.prs[link.url];
      if (!cached) return true;
      const age = Date.now() - cached.at,
        sig = signature(link);
      if (!cached.data) return age > MINUTE;
      if (sig && sig !== cached.sig) return true;
      if (cached.data.state === "MERGED") return !deployFinal(cached.data) && age > MINUTE;
      if (cached.data.state === "CLOSED") return false;
      const checksRun = ["PENDING", "EXPECTED"].includes(
        cached.data.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state,
      );
      return age > (checksRun ? MINUTE : sig ? 5 * MINUTE : 2 * MINUTE);
    };
    const links = this.model(agent).card.filter((link) => link.kind === "pr" && due(link));
    if (!links.length) return;
    const got = await fetchPrs(links);
    links.forEach((link, i) => {
      this.prs[link.url] = { at: Date.now(), sig: signature(link), data: got[i] };
    });
  }

  // The card: the task's main link (the first one in its first prompt), its ticket and the
  // branch's PRs. More: the first prompt's other links.
  model(agent) {
    const card = new Map();
    // A bare ID that Linear doesn't know ("UTF-8", "SHA-256") is no ticket.
    const unknown = (link) =>
      link.kind === "issue" && !link.url && this.issues[link.key] && !this.issues[link.key].data;
    const add = (link, start = false) => {
      if (link && !card.has(link.key) && !unknown(link)) card.set(link.key, { ...link, start });
    };
    const saved = this.starts[agent.address];
    const starts = saved?.created === agent.created_ms ? saved.links : [];
    add(
      starts.find((link) => !unknown(link)),
      true,
    );
    const branch = this.git[agent.cwd]?.branch ?? "";
    const ticket =
      starts.find((link) => link.kind === "issue" && !unknown(link))?.key ??
      (TICKET.test(branch) ? TICKET.exec(branch)[1].toUpperCase() : null);
    if (ticket) add({ kind: "issue", key: ticket, url: null });
    for (const pr of prsOnBranch(yourPrs(), branch, worktreeRepo(agent.cwd))) add(parse(pr.url));
    const more = starts.filter((link) => !card.has(link.key) && !unknown(link));
    return { ticket, card: [...card.values()], more };
  }

  // Render runs on every change in the app, so it looks up the agent only when the focus
  // changes, and builds the model only after a refresh or a new PR list.
  render(cx) {
    if (this.fixture) return panel(this.fixture, theme());
    const focus = focused(),
      focusKey = `${focus?.pane}|${focus?.terminal}|${focus?.agent}`;
    if (focusKey !== this.focusKey) {
      const agent = focusedTerminal();
      // A new terminal may not be listed yet: look again next render.
      this.focusKey = agent ? focusKey : null;
      if (agent && agent.address !== this.agent?.address) {
        this.agent = agent;
        this.stale = true;
      }
    }
    const visible = shown();
    if (visible && (this.stale || !this.wasVisible)) {
      this.stale = false;
      this.refresh(cx, true);
    }
    this.wasVisible = visible;
    const vmKey = `${this.ver}|${shared("task.prs")?.at}|${this.agent?.address}`;
    if (vmKey !== this.vmKey) {
      this.vmKey = vmKey;
      const mine = new Map(yourPrs().map((pr) => [pr.url.toLowerCase(), pr]));
      this.vm = {
        ...(this.agent ? this.model(this.agent) : { ticket: null, card: [], more: [] }),
        mine,
      };
    }
    return panel(this, theme());
  }
}
