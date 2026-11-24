// The tour's steps and the rules that move it on. Pure: main.js passes in Herdr's live lists.
import { TOUR_REPO, worktreeRepo, liveTitle } from "./lib/shared.js";

// A new pane's title is its terminal's address until the agent names itself.
const named = (lead, pane) => (liveTitle(pane) === lead.address ? null : liveTitle(pane));

// The demo's agents: the lead (started by New work) and the children it started.
export function world(allTerminals, allPanes) {
  const paneOf = new Map(allPanes.map((pane) => [pane.terminal, pane]));
  const agents = allTerminals.filter(
    (terminal) =>
      terminal.state === "live" &&
      terminal.status &&
      worktreeRepo(terminal.cwd) === TOUR_REPO &&
      paneOf.has(terminal.address),
  );
  const lead = agents.find((agent) => !agent.parent) ?? null;
  const kids = lead ? agents.filter((agent) => agent.parent === lead.address) : [];
  const busy = (agent) => agent.status === "working" || agent.status === "blocked";
  return {
    lead,
    title: lead ? named(lead, paneOf.get(lead.address)) : null,
    kids: kids.length,
    children: kids.map((kid) => kid.address),
    newest: kids.at(-1)?.address ?? null,
    settled: kids.length >= 2 && ![lead, ...kids].some(busy),
  };
}

const you = (text) => ({ tone: "you", text });
const busy = (text) => ({ tone: "busy", text });

// The text speaks to "you", warmly and plainly, and says what you get before how it works.
// The tour shows what will happen, lets you start it, then shows what happened. `act`: the
// step does nothing until you press this button; then main.js runs its entry work (typing).
// A status shares the footer with the button: keep it short (steps.test.mjs has the limit).
// `hold`: the tour types the step's prompt but leaves it unsent, and this button sends it.
// A step with `done(world)` has a goal: Next waits for it, and `wait` / `ok` say where it
// stands. `auto`: it moves on by itself, because your hands are on the keyboard.
// `card`: where the coach card sits (places.js), next to what the step shows. "above:<n>" is
// in the parent's pane, a few lines above its line n: where that step types. The sparkle
// floats where `spark(world)` says (places.js), else beside the card's button. A target with
// several places ("context", "kids") gets a sparkle on each: one splits into them.
// main.js adds to the world: `dialog` (New work is open), `starting` (it is starting the agent),
// `typed` (the step whose prompt is typed and waits for your Enter), `ready` (the step whose
// prompt the agents have answered).
// `quiet`: not in the welcome dialog's list.
// `focus`: the sections that stay clear while the others fade ("main" is the terminals).
// None: the whole app fades, as under a dialog.
export const STEPS = [
  {
    id: "new-work",
    title: "Got a task? Press ⌘⇧N",
    body: "This is how all work starts here. Describe a task or paste a ticket: we'll show you both, and how it picks a model.",
    card: "dialog",
    focus: [],
    spark: (world) => (world.dialog ? "start" : null),
    wait: (world) =>
      world.starting
        ? busy("Setting up your agent")
        : world.dialog
          ? you(["Looks good? Press", { chip: "Start" }, "or ⌘ Enter"])
          : null,
    done: (world) => Boolean(world.lead),
    auto: true,
  },
  {
    id: "title",
    card: "agents",
    focus: ["agents", "main"],
    spark: (world) => (world.title ? `row:${world.lead.address}` : null),
    title: "Work is automatically named",
    body: "Your agent gets its own space and worktree, so it never steps on your other work. Once it gets the task, it names itself.",
    ok: (world) => `It picked “${world.title}”`,
    done: (world) => Boolean(world.title),
  },
  {
    id: "context",
    card: "panel",
    focus: ["panel"],
    spark: () => "context",
    title: "The whole task, in one place",
    body: "This panel follows whichever agent you're on: the ticket, the PR, its checks and what's happened so far. No more hunting through tabs.",
  },
  {
    id: "children",
    card: "agents",
    focus: ["agents", "main"],
    // The prompt the tour types, then the first child's pane, then both.
    spark: (world) =>
      world.settled
        ? null
        : world.kids
          ? world.kids > 1
            ? "kids"
            : "kid:0"
          : world.lead && `ask:${world.lead.address}`,
    title: "Agents can bring in help",
    body: "Big ticket, two repos? Just ask, in plain words. Your agent starts a child agent for each one, in its own pane.",
    act: "Ask it",
    wait: (world) =>
      busy(
        !world.kids
          ? "Asking for two children"
          : world.kids < 2
            ? "Here comes the first child"
            : "Both children are on it",
      ),
    ok: () => "Both children finished",
    done: (world) => world.settled,
  },
  // Three beats of talking: the tour types each prompt (main.js) and says when the agents
  // have answered (`world.ready`).
  {
    id: "steer",
    card: "agents",
    focus: ["agents", "main"],
    spark: () => "type:0",
    title: "Talk to any child",
    body: "Each child is a full agent. Want something changed? Type right in its pane.",
    act: "Type it",
    wait: () => busy("Asking for one more thing"),
    ok: () => "Done, and pushed",
    done: (world) => world.ready === "steer",
  },
  {
    id: "status",
    quiet: true,
    card: "above:21",
    focus: ["agents", "main"],
    title: "Ask the parent for a status",
    body: "No need to check every pane. Ask the parent, and it reads its children for you.",
    act: "Ask it",
    wait: () => busy("Asking how it's going"),
    ok: () => "It checked both children",
    done: (world) => world.ready === "status",
  },
  {
    id: "tell",
    quiet: true,
    card: "above:31",
    focus: ["agents", "main"],
    // Once it is sent: both children, where the parent's message lands.
    spark: (world) => (world.lead?.status === "working" ? "kids" : null),
    title: "Tell them all at once",
    body: "Now pass it on. The parent messages each child, and they get to work. A whole team, from one prompt.",
    hold: "Send it",
    wait: (world) =>
      world.lead?.status === "working"
        ? busy("The parent is messaging both")
        : world.typed === "tell"
          ? null
          : busy("Writing a message for both"),
    ok: () => "Both children pushed fixes",
    done: (world) => world.ready === "tell",
  },
  {
    id: "end",
    focus: [],
    // A small fan of sparkles beside the card: one stays.
    spark: () => "burst",
    title: "That's it. You're ready!",
    body: "Next time you've got a ticket, a PR link or just a note, press ⌘⇧N and paste it in. We'll clean up this demo when you close the tour.",
  },
];

// Where a step stands: null (no goal), or { tone: "you" | "busy" | "ok", text }.
export function progress(step, world) {
  if (!step.done) return null;
  return step.done(world)
    ? { tone: "ok", text: step.ok?.(world) ?? "" }
    : (step.wait?.(world) ?? null);
}
