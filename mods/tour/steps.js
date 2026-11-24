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

// `body`: short lines, one thought each. They must fit the card (card.js) without wrapping.
// A step with `done(world)` has a goal: Next waits for it, and `wait` / `ok` say where it
// stands. `auto`: it moves on by itself, because your hands are on the keyboard.
// `card`: where the coach card sits (places.js), next to what the step shows. The sparkle
// floats where `spark(world, beat)` says (places.js), else beside the card's button.
// `world.dialog` (main.js): the New work dialog is open.
// `focus`: the sections that stay clear while the others fade ("main" is the terminals).
// None: the whole app fades, as under a dialog.
export const STEPS = [
  {
    id: "new-work",
    title: "Start work with ⌘⇧N",
    body: [
      "Press ⌘⇧N. A sample task types itself.",
      "Name a model, even misspelled, to pick it.",
      "⌘ Enter starts the agent in a worktree.",
    ],
    card: "dialog",
    focus: [],
    spark: (world) => (world.dialog ? "start" : null),
    wait: (world) => you(world.dialog ? "Now press ⌘ Enter" : "Your turn: press ⌘⇧N"),
    done: (world) => Boolean(world.lead),
    auto: true,
  },
  {
    id: "title",
    card: "agents",
    focus: ["agents", "main"],
    spark: (world) => (world.title ? `row:${world.lead.address}` : null),
    title: "Work names itself",
    body: [
      "The agent runs in its own space.",
      "It starts out named after a city.",
      "Then lasso names it after the job.",
    ],
    wait: () => busy("The agent is reading the task"),
    ok: (world) => `Named “${world.title}”`,
    done: (world) => Boolean(world.title),
  },
  {
    id: "context",
    card: "panel",
    focus: ["panel"],
    spark: (_world, beat) => `context:${beat}`,
    title: "The task at a glance",
    body: [
      "This panel follows the agent you are on.",
      "Ticket, PR, checks, branch and a recap.",
      "Here it shows sample data.",
    ],
  },
  {
    id: "children",
    card: "agents",
    focus: ["agents", "main"],
    // The prompt the tour types, then each new child's sidebar row, then the line that waits
    // for you.
    spark: (world) =>
      world.blocked
        ? `enter:${world.blocked}`
        : world.settled
          ? null
          : world.newest
            ? `row:${world.newest}`
            : world.lead && `ask:${world.lead.address}`,
    title: "Agents start agents",
    body: [
      "No commands to learn. Just ask an agent.",
      "Watch the tour ask for two helpers.",
      "Children sit under their parent.",
    ],
    wait: (world) =>
      world.blocked
        ? you("Your turn: click the pane that needs you, press Enter")
        : busy(
            !world.kids
              ? "Typing a request to the agent"
              : world.kids < 2
                ? "A child appears under its parent"
                : "The children are working",
          ),
    ok: () => "Both children are done",
    done: (world) => world.settled,
  },
  {
    id: "end",
    focus: [],
    title: "That's lasso",
    body: [
      "Try it for real: press ⌘⇧N.",
      "Paste a ticket, a PR link or a note.",
      "Finish removes the demo.",
    ],
  },
];

// Where a step stands: null (no goal), or { tone: "you" | "busy" | "ok", text }.
export function progress(step, world) {
  if (!step.done) return null;
  return step.done(world) ? { tone: "ok", text: step.ok?.(world) ?? "" } : step.wait(world);
}
