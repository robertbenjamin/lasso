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

// A step with `done(world)` has a goal: Next waits for it, and `wait` / `ok` say where it
// stands. `auto`: it moves on by itself, because your hands are on the keyboard.
// `card`: where the coach card sits (places.js), next to what the step shows. The sparkle
// floats where `spark(world, beat)` says (places.js), else beside the card's button.
// `world.dialog` (main.js): the New work dialog has opened.
// `focus`: the sections that stay clear while the others fade.
export const STEPS = [
  {
    id: "new-work",
    title: "Start work with ⌘⇧N",
    body: "Press ⌘⇧N. A sample task is typed in for you: start it with ⌘ Enter. lasso makes a worktree and starts an agent in it.",
    card: "dialog",
    spark: (world) => (world.dialog ? "start" : null),
    wait: () => you("Your turn: press ⌘⇧N"),
    done: (world) => Boolean(world.lead),
    auto: true,
  },
  {
    id: "title",
    card: "agents",
    focus: ["agents"],
    spark: (world) => (world.title ? `row:${world.lead.address}` : null),
    title: "Work names itself",
    body: "New work opens in the background, in its own space under its repo. It starts with the branch name, a city. lasso renames it after what the agent does: see the sidebar.",
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
    body: "The Context panel on the right follows the agent you focus: its ticket, its PR with checks and reviews, the branch and a recap. Here it shows sample data.",
  },
  {
    id: "children",
    card: "agents",
    focus: ["agents"],
    // The parent's sidebar row, then each new child's, then the line that waits for you.
    spark: (world) =>
      world.blocked
        ? `enter:${world.blocked}`
        : world.settled
          ? null
          : `row:${world.newest ?? world.lead?.address}`,
    title: "Agents start agents",
    body: "Ask in plain words, like the prompt the tour just sent. Each child gets its own pane and sits under its parent in the sidebar. A child that needs you turns red there.",
    wait: (world) =>
      world.blocked
        ? you("Your turn: click the blocked child's pane, press Enter")
        : busy(world.kids < 2 ? "The agent is starting 2 children" : "The children are working"),
    ok: () => "Both children are done",
    done: (world) => world.settled,
  },
  {
    id: "end",
    title: "That's lasso",
    body: "Now try real work: press ⌘⇧N and paste a ticket, a PR link or a note. Finish removes the demo repo and its agents.",
  },
];

// Where a step stands: null (no goal), or { tone: "you" | "busy" | "ok", text }.
export function progress(step, world) {
  if (!step.done) return null;
  return step.done(world) ? { tone: "ok", text: step.ok?.(world) ?? "" } : step.wait(world);
}
