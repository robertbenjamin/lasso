// The tour's steps and the rules that move it on. Pure: main.js passes in Herdr's live lists.
import { TOUR_REPO, worktreeRepo, liveTitle } from "./lib/shared.js";

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
    title: lead ? liveTitle(paneOf.get(lead.address)) : null,
    kids: kids.length,
    newest: kids.at(-1)?.address ?? null,
    blocked: kids.find((kid) => kid.status === "blocked")?.address ?? null,
    settled: kids.length >= 2 && ![lead, ...kids].some(busy),
  };
}

const you = (text) => ({ tone: "you", text });
const busy = (text) => ({ tone: "busy", text });

// The text speaks to "you", warmly and plainly, and says what you get before how it works.
// A step with `done(world)` has a goal: Next waits for it, and `wait` / `ok` say where it
// stands. `auto`: it moves on by itself, because your hands are on the keyboard.
// `card`: where the coach card sits (places.js), next to what the step shows. The sparkle
// floats where `spark(world, beat)` says (places.js), else beside the card's button.
// main.js adds to the world: `dialog` (New work is open), `starting` (it is starting the agent).
// `focus`: the sections that stay clear while the others fade ("main" is the terminals).
// None: the whole app fades, as under a dialog.
export const STEPS = [
  {
    id: "new-work",
    title: "Got a task? Press ⌘⇧N",
    body: "This is how all work starts here. Describe a task or paste a ticket: we'll show you both, and how it picks a model. Press ⌘ Enter when you're ready.",
    card: "dialog",
    focus: [],
    spark: (world) => (world.dialog ? "start" : null),
    wait: (world) =>
      world.starting
        ? busy("Setting up your agent")
        : you(world.dialog ? "Looks good? Press ⌘ Enter" : "Go ahead, press ⌘⇧N"),
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
    wait: () => busy("Your agent is reading the task"),
    ok: (world) => `It picked “${world.title}”`,
    done: (world) => Boolean(world.title),
  },
  {
    id: "context",
    card: "panel",
    focus: ["panel"],
    spark: (_world, beat) => `context:${beat}`,
    title: "The whole task, in one place",
    body: "This panel follows whichever agent you're on: the ticket, the PR, its checks and what's happened so far. No more hunting through tabs. This one's sample data.",
  },
  {
    id: "children",
    card: "agents",
    focus: ["agents", "main"],
    // The prompt the tour types, then each new child's pane, then the line that waits for you.
    spark: (world) =>
      world.blocked
        ? `enter:${world.blocked}`
        : world.settled
          ? null
          : world.kids
            ? `kid:${world.kids - 1}`
            : world.lead && `ask:${world.lead.address}`,
    title: "Agents can bring in help",
    body: "Big ticket, two repos? Just ask, like we're doing now. Your agent starts a child agent for each one, in its own pane. If one needs you, it'll say so.",
    wait: (world) =>
      world.blocked
        ? you("This child needs you: click its pane and press Enter")
        : busy(
            !world.kids
              ? "Asking for two children"
              : world.kids < 2
                ? "Here comes the first child"
                : "Both children are on it",
          ),
    ok: () => "Both children finished",
    done: (world) => world.settled,
  },
  {
    id: "end",
    focus: [],
    title: "That's it. You're ready!",
    body: "Next time you've got a ticket, a PR link or just a note, press ⌘⇧N and paste it in. We'll clean up this demo when you close the tour.",
  },
];

// Where a step stands: null (no goal), or { tone: "you" | "busy" | "ok", text }.
export function progress(step, world) {
  if (!step.done) return null;
  return step.done(world) ? { tone: "ok", text: step.ok?.(world) ?? "" } : step.wait(world);
}
