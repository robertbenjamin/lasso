// Shared state this file writes:
//   task.recaps { [address]: { created, key, at, summary, steps: [{ at, text }] } }
// A short recap of each live agent's session, for the Context panel.

import { terminals, shared, setShared, exec } from "herdr";
import { bin } from "./lib/shared.js";
import { readSession, fingerprint, oneLine } from "./titles.js";

const EVERY = 2 * 60000; // at most one Haiku call per agent in this time

// Haiku's answer: a summary line, then "3 | Fixed the login test" lines. `times[n - 1]` is
// prompt n's time.
export function parseRecap(answer, times) {
  const lines = answer
    .split("\n")
    .map((line) => line.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean);
  const clean = (text) => text.replace(/^["\s]+|[".\s]+$/g, "");
  const summary = clean(lines.find((line) => !line.includes(" | ")) ?? "");
  const steps = lines
    .map((line) => /^(\d+)\s*\|\s*(.+)$/.exec(line))
    .filter(Boolean)
    .map(([, n, text]) => ({ at: times[Number(n) - 1] ?? null, text: clean(text) }))
    .filter((step) => step.text)
    .slice(0, 5);
  return summary ? { summary, steps } : null;
}

function recapInput({ prompts, answers }) {
  const picked = prompts.map((prompt, i) => `${i + 1}. ${oneLine(prompt, 200)}`);
  // Keep the first and the latest prompts: drop from the middle.
  while (picked.join("\n").length > 4000 && picked.length > 6)
    picked.splice(Math.floor(picked.length / 2), 1);
  const last = answers.at(-1);
  return (
    `<prompts>\n${picked.join("\n")}\n</prompts>` +
    (last ? `\n<agent>\n${oneLine(last, 600)}\n</agent>` : "")
  );
}

// At most 4 calls per run. A recap is redone when a prompt or the last answer changes.
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
    if (old && Date.now() - old.at < EVERY) continue;
    const session = await readSession(file).catch(() => null);
    if (!session?.prompts.length) continue;
    const key = fingerprint(session.prompts.join("\n") + (session.answers.at(-1) ?? ""));
    if (old?.key === key) continue;
    budget--;
    const result = await exec(bin("lasso-recap"), [recapInput(session)]).catch(() => null);
    const recap = result?.code === 0 ? parseRecap(result.stdout, session.times) : null;
    // A failure keeps the old recap and waits EVERY before it tries again.
    recaps[agent.address] = {
      ...old,
      ...recap,
      created: agent.created_ms,
      key: recap ? key : old?.key,
      at: Date.now(),
    };
    setShared("task.recaps", { ...recaps });
  }
  setShared("task.recaps", recaps);
}
