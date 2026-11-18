// Shared state this file writes:
//   task.sessionPrs   { [address]: { file, size, urls } }   the PRs each agent's session made
//   task.transcripts  { [address]: path }                   each live agent's Claude transcript

import { terminals, shared, setShared, exec } from "herdr";
import { bin } from "./shared.js";

// Null for other programs, and for agents on other machines (an address with a "/").
export async function findTranscript(address) {
  if (!address || address.includes("/")) return null;
  const result = await exec(bin("lasso-transcript"), [address]);
  return result.stdout.trim() || null;
}

// A session can open a PR for a branch no pane is on (a worktree it only cd's into), so the
// PRs come from the tool calls that made them. Null when the transcript is unchanged.
async function scanSessionPrs(file, lastSize) {
  const result = await exec(bin("lasso-session-prs"), [file, String(lastSize ?? "")]);
  const [size, ...urls] = result.stdout.trim().split("\n");
  if (result.code !== 0 || size === String(lastSize)) return null;
  return { size: Number(size), urls: urls.filter(Boolean) };
}

export async function refreshSessionPrs() {
  const old = shared("task.sessionPrs") ?? {};
  const next = {},
    paths = {};
  for (const agent of terminals().filter((t) => t.state === "live" && t.program?.agent)) {
    const prev = old[agent.address];
    try {
      const file = await findTranscript(agent.address);
      if (!file) continue;
      paths[agent.address] = file;
      const scan = await scanSessionPrs(file, prev?.file === file ? prev.size : null);
      const keep = scan ? { file, ...scan } : prev;
      if (keep) next[agent.address] = keep;
    } catch {
      if (prev) next[agent.address] = prev;
    }
  }
  setShared("task.sessionPrs", next);
  setShared("task.transcripts", paths);
}
