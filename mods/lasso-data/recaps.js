// Shared state this file writes:
//   task.recaps { [address]: { created, turn, v, at, summary, steps: [{ at, text, prompt, place, uuid }] } }
// A short recap of each live agent's session, for the Context panel.

import { terminals, shared, setShared, exec } from "herdr";
import { bin, words } from "./lib/shared.js";
import { readSession, oneLine } from "./titles.js";

const EVERY = 2 * 60000; // at most one Haiku call per agent in this time
// Bump when the recap's fields or bin/lasso-recap change: every recap is made again once.
const RECAP_VERSION = 6;

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
  const count = prompts.length,
    firstLine = (n) => prompts[n - 1].split("\n")[0].replace(/\s+/g, " ").trim();
  const said = new Map();
  for (const line of lines) {
    const [, n, text] = /^(\d+)\s*\|\s*(.+)$/.exec(line) ?? [];
    if (n >= 1 && n <= count && clean(text)) said.set(Number(n), clean(text));
  }
  for (const n of count ? [1, count] : []) if (!said.has(n)) said.set(n, words(firstLine(n), 7));
  const ns = [...said.keys()].sort((a, b) => a - b);
  const steps = (ns.length > 5 ? [ns[0], ...ns.slice(-4)] : ns).map((n) => ({
    at: times[n - 1] ?? null,
    text: said.get(n),
    prompt: firstLine(n).slice(0, 30),
    place: count > 1 ? (n - 1) / (count - 1) : 1,
    uuid: uuids[n - 1] ?? null,
  }));
  return { summary, steps };
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

// At most 4 calls per run. A recap is redone after a new turn, so an idle agent costs nothing.
export async function refreshRecaps() {
  const paths = shared("task.transcripts") ?? {};
  const agents = terminals().filter((t) => t.state === "live" && t.program?.agent);
  const live = new Set(agents.map((agent) => agent.address));
  const recaps = Object.fromEntries(
    Object.entries(shared("task.recaps") ?? {}).filter(([address]) => live.has(address)),
  );
  let budget = 4;
  for (const agent of agents) {
    const file = paths[agent.address];
    if (!file || budget <= 0 || agent.status === "working") continue;
    const old = recaps[agent.address]?.created === agent.created_ms ? recaps[agent.address] : null;
    const fresh = old?.turn === agent.turn && old.v === RECAP_VERSION;
    if (old && (fresh || Date.now() - old.at < EVERY)) continue;
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
  // Drops the agents that ended.
  if (Object.keys(recaps).length !== Object.keys(shared("task.recaps") ?? {}).length)
    setShared("task.recaps", recaps);
}
