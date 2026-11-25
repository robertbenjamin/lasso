// Shared state this file writes:
//   task.recaps { [address]: { created, turn, v, at, summary, steps: [{ at, text, prompt, place, uuid }] } }
//   task.latest { [address]: { created, ...step } }  your latest prompt, before Haiku recaps it
// A short recap of each live agent's session, for the Context panel.

import { terminals, shared, setShared, exec } from "herdr";
import { bin, words, STEPS } from "./lib/shared.js";
import { readSession, oneLine } from "./titles.js";

const EVERY = 2 * 60000; // at most one Haiku call per agent in this time
// Bump when the recap's fields or bin/lasso-recap change: every recap is made again once.
const RECAP_VERSION = 8;

// Haiku's answer: a summary line, then "3 | Fixed the login test" lines, n being the prompt.
// The first and the latest prompts always show, in their own words when Haiku left them out.
// `prompt` is how its line starts on screen, after "❯ ", and `place` where it sits in the chat
// (0 first, 1 latest): the Context panel scrolls there from the nearer end, when it cannot
// jump to the prompt's chat row, `uuid`.
export function parseRecap(answer, { times, prompts, uuids = [] }) {
  const lines = answer
    .split("\n")
    .map((line) => line.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean);
  const clean = (text) => text.replace(/^["\s]+|[".\s]+$/g, "");
  const summary = clean(lines.find((line) => !line.includes(" | ")) ?? "");
  if (!summary) return null;
  const count = prompts.length;
  const said = new Map();
  for (const line of lines) {
    const [, n, text] = /^(\d+)\s*\|\s*(.+)$/.exec(line) ?? [];
    if (n >= 1 && n <= count && clean(text)) said.set(Number(n), clean(text));
  }
  for (const n of count ? [1, count] : []) if (!said.has(n)) said.set(n, ownWords(prompts[n - 1]));
  const ns = [...said.keys()].sort((a, b) => a - b);
  const steps = (ns.length > STEPS ? [ns[0], ...ns.slice(1 - STEPS)] : ns).map((n) =>
    step(n, said.get(n), { times, prompts, uuids }),
  );
  return { summary, steps };
}

function step(n, text, { times, prompts, uuids = [] }) {
  const count = prompts.length;
  return {
    at: times[n - 1] ?? null,
    text,
    prompt: firstLine(prompts[n - 1]).slice(0, 30),
    place: count > 1 ? (n - 1) / (count - 1) : 1,
    uuid: uuids[n - 1] ?? null,
  };
}

const firstLine = (prompt) => prompt.split("\n")[0].replace(/\s+/g, " ").trim();

// A prompt as a step, capitalized like Haiku's steps.
function ownWords(prompt) {
  const text = words(firstLine(prompt), 7);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// The latest prompt as a step in its own words, for the Context panel to show until the recap has it.
export function latestStep(session) {
  const count = session.prompts.length;
  return count ? step(count, ownWords(session.prompts[count - 1]), session) : null;
}

// Each prompt with the agent's last answer to it, so Haiku sees which prompts mattered.
function recapInput({ prompts, replies }) {
  const picked = prompts.map(
    (prompt, i) =>
      `${i + 1}. ${oneLine(prompt, 150)}` +
      (replies[i] ? `\n   agent: ${oneLine(replies[i], 250)}` : ""),
  );
  // Keep the first and the latest prompts: drop from the middle.
  while (picked.join("\n").length > 6000 && picked.length > 6)
    picked.splice(Math.floor(picked.length / 2), 1);
  return `<session>\n${picked.join("\n")}\n</session>`;
}

const liveAgents = () => terminals().filter((t) => t.state === "live" && t.program?.agent);

// The shared map `key` without the agents that ended, saved when one did.
function liveOnly(key, agents) {
  const live = new Set(agents.map((agent) => agent.address));
  const all = shared(key) ?? {};
  const kept = Object.fromEntries(Object.entries(all).filter(([address]) => live.has(address)));
  if (Object.keys(kept).length !== Object.keys(all).length) setShared(key, kept);
  return kept;
}

// Each working agent's newest prompt, also one sent mid-turn. Only a working agent gets new
// prompts, and an idle one has Haiku's recap.
export async function refreshLatest() {
  const paths = shared("task.transcripts") ?? {};
  const agents = liveAgents();
  const latest = liveOnly("task.latest", agents);
  for (const agent of agents) {
    const file = paths[agent.address];
    if (!file || agent.status !== "working") continue;
    const session = await readSession(file).catch(() => null);
    const newest = session && latestStep(session);
    if (newest && newest.at !== latest[agent.address]?.at) {
      latest[agent.address] = { ...newest, created: agent.created_ms };
      setShared("task.latest", { ...latest });
    }
  }
}

// At most 4 calls per run. A recap is redone after a new turn, so an idle agent costs nothing.
export async function refreshRecaps() {
  const paths = shared("task.transcripts") ?? {};
  const agents = liveAgents();
  const recaps = liveOnly("task.recaps", agents);
  let budget = 4;
  for (const agent of agents) {
    const file = paths[agent.address];
    if (!file || budget <= 0 || agent.status === "working") continue;
    const old = recaps[agent.address]?.created === agent.created_ms ? recaps[agent.address] : null;
    const fresh = old?.turn === agent.turn && old?.v === RECAP_VERSION;
    if (fresh || (old && Date.now() - old.at < EVERY)) continue;
    const session = await readSession(file).catch(() => null);
    if (!session?.prompts.length) continue;
    budget--;
    const result = await exec(bin("lasso-recap"), [recapInput(session)]).catch(() => null);
    const recap = result?.code === 0 ? parseRecap(result.stdout, session) : null;
    // A failure keeps the old recap and waits EVERY before it tries again.
    recaps[agent.address] = {
      ...old,
      ...recap,
      created: agent.created_ms,
      turn: recap ? agent.turn : old?.turn,
      v: recap ? RECAP_VERSION : old?.v,
      at: Date.now(),
    };
    setShared("task.recaps", { ...recaps });
  }
}
