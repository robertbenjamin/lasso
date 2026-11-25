// What this tour does to the app: the demo repo, the draft New work types, and each step's
// entry work. steps.js says what the card shows, places.js where.
import {
  exec,
  home,
  run,
  shared,
  setShared,
  spaces,
  terminals,
  panes,
  layout,
  focused,
} from "herdr";
import { TOUR_REPO, bin, find } from "./lib/shared.js";
import { type } from "./type.js";

// The demo repo: an empty git repo in ~/.herdr/tour. New work makes its worktrees in
// ~/.herdr/worktrees/<TOUR_REPO>, as for any repo.
const roots = () => [`${home()}/.herdr/tour`, `${home()}/.herdr/worktrees/${TOUR_REPO}`];
const inDemo = (folder) => roots().some((root) => folder?.startsWith(`${root}/`));
const demoRepo = () => `${roots()[0]}/${TOUR_REPO}`;

// The commit needs an author, and a new machine may have none set.
const AUTHOR = ["-c", "user.name=lasso tour", "-c", "user.email=tour@lasso.invalid"];

export async function up() {
  await exec("git", ["init", "-q", "-b", "main", demoRepo()]);
  const args = ["-C", demoRepo(), ...AUTHOR, "commit", "-q", "--allow-empty", "-m", "Start"];
  const commit = await exec("git", args);
  if (commit.code !== 0)
    throw new Error(commit.stderr.trim() || "git could not make the demo repo");
}

// Terminals first: Herdr shows a closed space again while its terminals still run.
// Nothing is awaited before the `rm` starts: the tour runs this from a card that is closing,
// and only a command that already runs survives that.
export async function down() {
  for (const terminal of terminals())
    if (inDemo(terminal.cwd)) run("terminal.kill", { terminal: terminal.address });
  for (const space of spaces())
    if (inDemo(space.folder)) run("space.close", { id: space.id, confirmed: true });
  await exec("rm", ["-rf", ...roots()]);
}

// What the New work dialog types by itself: a task, a model named twice (once misspelled on
// purpose: it is still picked), then a pasted ticket link in its place.
const TYPING = [
  { wait: 400 },
  { type: "Fix the checkout test that fails one run in ten" },
  { wait: 350 },
  { type: " with sonet" },
  { wait: 900 },
  { erase: 5 },
  { type: "opus" },
  { wait: 1300 },
  { paste: "https://linear.app/acme/issue/SHOP-42", say: "Pasting a link works too!" },
];

// Once the tour's state is clear: New work gets its draft, and the Work view and the sidebar
// show, so the card and the sparkle sit beside it.
export function begin() {
  setShared("tour.layout", arrangement());
  setShared("newwork.draft", {
    script: TYPING,
    lit: true,
    repo: demoRepo(),
    agent: bin("lasso-tour-agent"),
  });
  run("layout.select", { stack: "work-stack", child: "work" });
  run("layout.show", { id: "sidebar" });
}

// What the tour changes in the layout: begin() and the steps' entry work (ENTER).
function arrangement() {
  const root = layout(),
    node = (id) => find(root, id) ?? {},
    at = focused() ?? {};
  return {
    panel: Boolean(node("panel").hidden),
    sidebar: Boolean(node("sidebar").hidden),
    body: node("panel-body").active ?? null,
    work: node("work-stack").active ?? null,
    space: at.space ?? null,
    pane: at.pane ?? null,
    terminal: at.terminal ?? null,
  };
}

// The tour's end puts back what it changed, before clear() drops the record and before down()
// closes the demo's space. A command that fails must not stop the tour from ending.
export function restore() {
  const before = shared("tour.layout"),
    now = arrangement();
  if (!before) return;
  const attempt = (name, args) => {
    try {
      run(name, args);
    } catch {
      // The rest still goes back.
    }
  };
  if (before.body && before.body !== now.body)
    attempt("layout.select", { stack: "panel-body", child: before.body });
  if (before.work && before.work !== now.work)
    attempt("layout.select", { stack: "work-stack", child: before.work });
  for (const id of ["panel", "sidebar"])
    if (before[id] !== now[id]) attempt(before[id] ? "layout.hide" : "layout.show", { id });
  if (before.terminal === now.terminal && before.pane === now.pane) return;
  const { space, pane, terminal } = before;
  const alive = terminal
    ? terminals().some((each) => each.address === terminal)
    : panes().some((each) => each.pane === pane);
  if (!alive || !spaces().some((each) => each.id === space)) return;
  attempt("space.select", { id: space });
  attempt("pane.focus", terminal ? { terminal } : { pane });
}

// What a step's own button (steps.js) and ⌘⇧. do, by step id: true when they did something.
export const PRESS = {
  // Opens New work, then presses its Start. A shared key: mod commands do not reach New work.
  "new-work": (now) => {
    if (now.starting) return false;
    if (now.dialog) setShared("newwork.start", true);
    else run("mod.open", { name: "new-work" });
    return true;
  },
};

// What the tour types to the lead agent: a prompt from daily use (README, "Prompts that
// work"). No colon: `hc keys` has no key for one.
const ASK = "make sub issues for each repo and implement in children";

// What the tour does on the way into a step, by step id, given the world (steps.js). The
// step's new card runs it, or its `act` button does.
export const ENTER = {
  // New work opens in the background: bring the new agent to the front.
  title: ({ lead }) => {
    if (!lead) return;
    run("space.select", { id: lead.labels?.["herdr.space"] });
    run("pane.focus", { terminal: lead.address });
  },
  context: () => {
    run("layout.select", { stack: "panel-body", child: "context" });
    run("layout.show", { id: "panel" });
  },
  // The prompt shows before the children do, so you see what was asked.
  children: ({ lead }) => type(lead?.address, ASK),
  steer: ({ children }) => type(children[0], "also cover the timeout case", "steer"),
  status: ({ lead }) => type(lead?.address, "status?", "status"),
  // Yours to send: the parent's pane gets the keyboard, so Enter goes there.
  tell: ({ lead }) => {
    if (lead) run("pane.focus", { terminal: lead.address });
    type(lead?.address, "address feedback for both", "tell", "pass that on");
  },
};
