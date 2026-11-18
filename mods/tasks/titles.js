// Shared state this file writes:
//   task.titles { [tabId | childAddress]: { text, short, turn, at, v, key } }

import { panes, spaces, terminals, shared, setShared, exec } from "herdr";
import { bin, TICKET, isFeatureBranch } from "./shared.js";

const TICKET_ONLY = /^[a-z]{2,6}-\d+$/i;
// Small words that can't end a title: "Ruleset split and" -> "Ruleset split".
const LOOSE_END = /(\s+(and|or|but|for|the|of|to|with|in|on|at|by|from|a|an|vs))+$/i;

// Its first agent, else its first focused terminal, else its first terminal.
export function leadPanes(allPanes) {
  const leads = new Map();
  for (const pane of allPanes) {
    if (!pane.terminal) continue;
    const lead = leads.get(pane.tab);
    const better =
      lead && !lead.program?.agent && (pane.program?.agent || (!lead.focused && pane.focused));
    if (!lead || better) leads.set(pane.tab, pane);
  }
  return leads;
}

// "owner/abc-4512-contract-type" -> "contract type" ("" when the branch is only a ticket ID)
const prettyBranch = (branch) =>
  branch
    .replace(/^[\w.-]+\//, "")
    .replace(TICKET, "")
    .replace(/[-_]+/g, " ")
    .trim();

// Not a shell's folder, a path or the program's own name. `pane` may be a terminal: a parked
// child has no pane.
export function liveTitle(pane) {
  if (!pane || pane.program?.shell) return null;
  const raw = pane.title ?? "";
  const title = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  const isPath =
    /^[~/]|^[A-Za-z]:\\/.test(raw.replace(/^[^\p{L}\p{N}~/]+/u, "")) || /^\S*\/\S*$/.test(title);
  const isProgram = title === pane.program?.name || title.toLowerCase() === pane.program?.key;
  return title && !isProgram && !isPath && !title.includes("@") ? title : null;
}

// Herdr names agent tabs after the program ("Claude Code"): that is no name.
const named = (tab, lead) => Boolean(tab?.named) && tab.name !== lead?.program?.name;

function fallback(lead, info) {
  const live = liveTitle(lead);
  if (live) return live;
  const branch = isFeatureBranch(info?.branch) ? prettyBranch(info.branch) : "";
  if (branch) return branch;
  if (lead?.program?.agent) return "New session";
  return lead?.program?.shell || !lead?.program?.name ? "shell" : lead.program.name;
}

// A PR is a chip, never a title.
export function title(tab, lead, info) {
  if (named(tab, lead)) return tab.name;
  if (info?.summary && lead?.program?.agent) return info.summary;
  return fallback(lead, info);
}

export function shortTitle(tab, lead, info) {
  if (named(tab, lead)) return tab.name;
  if (lead?.program?.agent && (info?.summaryShort || info?.summary))
    return info.summaryShort ?? words(info.summary, 3);
  return fallback(lead, info);
}

const RETITLE_TURNS = 5;
const RETITLE_AFTER = 20 * 60000;
const RETRY_AFTER = 10 * 60000;
// Bump when the title rules or bin/lasso-title change: every title is written again once.
const TITLE_VERSION = 7;

// Null for other programs, and for agents on other machines (an address with a "/").
export async function findTranscript(address) {
  if (!address || address.includes("/")) return null;
  const result = await exec(bin("lasso-transcript"), [address]);
  return result.stdout.trim() || null;
}

async function readSession(file) {
  const result = await exec(bin("lasso-session"), [file]);
  const prompts = [],
    answers = [];
  let aiTitle = null;
  for (const line of result.stdout.split("\n")) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (entry.type === "ai-title") aiTitle = entry.aiTitle ?? null;
    else if (entry.type === "user" && !entry.isMeta && typeof content === "string") {
      // Typed prompts and messages from other agents (<hc from="t7">…</hc>). Slash commands
      // and system notes start with "/" or "<".
      const prompt = content
        .trim()
        .replace(/^<hc from="[^"]*">([\s\S]*)<\/hc>$/, "$1")
        .trim();
      if (prompt && !prompt.startsWith("<") && !prompt.startsWith("/")) prompts.push(prompt);
    } else if (entry.type === "assistant" && Array.isArray(content)) {
      const text = content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim();
      if (text && answers.at(-1) !== text) answers.push(text);
    }
  }
  return { prompts, answers, aiTitle };
}

function fingerprint(text) {
  // djb2
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
const NO_PROMPTS = fingerprint("");

const oneLine = (text, max) => {
  const flat = text.replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

// `key` fingerprints your prompts: unchanged prompts need no new call. Without a transcript,
// the prompts and the end of the screen.
async function titleInput(screen, address) {
  const file =
    (shared("task.transcripts") ?? {})[address] ??
    (await findTranscript(address).catch(() => null));
  const {
    prompts,
    answers = [],
    aiTitle,
  } = file ? await readSession(file).catch(() => ({ prompts: [] })) : { prompts: [] };
  if (!prompts.length) {
    const onScreen = screen
      .split("\n")
      .filter((line) => /^\s*❯ \S/.test(line))
      .map((line) => line.replace(/^\s*❯ /, "").trim());
    return {
      key: fingerprint(onScreen.join("\n")),
      input: `<prompts>\n${onScreen.join("\n")}\n</prompts>\n<agent>\n${screen.slice(-2000)}\n</agent>`,
    };
  }
  const links = [
    ...new Set(prompts.join("\n").match(/https?:\/\/(?:linear\.app|github\.com)\/\S+/g) ?? []),
  ];
  const picked = prompts.map((p) => oneLine(p, 200));
  while (picked.join("\n").length > 3000 && picked.length > 4)
    picked.splice(Math.floor(picked.length / 2), 1);
  const said = [answers[0], answers.length > 1 ? answers.at(-1) : null]
    .filter(Boolean)
    .map((a) => oneLine(a, 300));
  return {
    key: fingerprint(prompts.join("\n")),
    input:
      (links.length ? `<links>\n${links.join("\n")}\n</links>\n` : "") +
      `<prompts>\n${picked.map((p) => `- ${p}`).join("\n")}\n</prompts>` +
      (said.length ? `\n<agent>\n${said.join("\n")}\n</agent>` : "") +
      (aiTitle ? `\n<claude-title>${aiTitle}</claude-title>` : ""),
  };
}

function tidy(text) {
  const cleaned = text
    .replace(/\(?\b[A-Z]{2,6}-\d+\b\)?:?\s*/g, "")
    .replace(/\(?\b(?:PR|pull request)\s*#?\d+\b\)?\s*|\(?#\d+\b\)?\s*/gi, "")
    .replace(/^["'#*\s]+|["'.*\s]+$/g, "")
    .replace(/^title:\s*/i, "");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// A first clause of 2 to n+1 words wins: "Herdr UI, auto-run and sandbox" -> "Herdr UI".
export function words(text, n) {
  const clause = text.split(/[,:;]\s/)[0];
  const clauseFits = /\s/.test(clause) && clause.split(/\s+/).length <= n + 1;
  const pick = clauseFits ? clause : text.split(/\s+/).slice(0, n).join(" ");
  return pick
    .replace(/\s*\([^)]*$/, "")
    .replace(/[\s,:;.-]+$/, "")
    .replace(LOOSE_END, "");
}

// Haiku does not always keep to the lengths.
export function parseTitles(answer) {
  const line = answer
    .split("\n")
    .filter((candidate) => candidate.includes(" | "))
    .at(-1);
  if (!line) {
    const long = words(tidy(answer.trim().split("\n")[0] ?? ""), 12);
    return long ? { short: words(long, 4), long } : null;
  }
  const [shortPart, longPart] = line.split(" | ");
  const short = tidy(shortPart),
    long = words(tidy(longPart ?? ""), 12) || short;
  if (!short) return null;
  return { short: short.split(/\s+/).length > 5 ? words(short, 4) : short, long };
}

const badShort = (short) =>
  TICKET_ONLY.test(short) || /[,:;]$/.test(short) || LOOSE_END.test(short);

// `started`: the agent has something to name.
export function titleDue(old, turn, started, now) {
  if (!started) return false;
  if (!old) return true;
  const age = now - old.at;
  if (!old.text) return age > RETRY_AFTER;
  if (old.v !== TITLE_VERSION) return true;
  if (old.short && badShort(old.short)) return age > RETRY_AFTER;
  const moreTurns = turn - old.turn >= RETITLE_TURNS || turn < old.turn; // or a restart
  return moreTurns && age > RETITLE_AFTER;
}

// At most 8 per run (a call takes 2 to 3 s). A child agent shares its parent's tab, so its
// title is keyed by its address; a child that leads a tab gets both keys.
export async function refreshTitles() {
  const allTerminals = terminals();
  const turns = new Map(allTerminals.map((t) => [t.address, t.turn ?? 0]));
  const kids = new Map(
    allTerminals.filter((k) => k.parent && k.state === "live").map((k) => [k.address, k]),
  );
  const allPanes = panes();
  const paneOf = new Map(allPanes.filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const tabs = new Map(
    spaces()
      .flatMap((s) => s.tabs)
      .map((tab) => [tab.id, tab]),
  );

  // Not while the window has no tabs yet (at start), or every title would go and be written again.
  const live = new Set([...tabs.keys(), ...allTerminals.map((t) => t.address)]);
  const saved = shared("task.titles") ?? {};
  if (tabs.size && Object.keys(saved).some((k) => !live.has(k)))
    setShared(
      "task.titles",
      Object.fromEntries(Object.entries(saved).filter(([k]) => live.has(k))),
    );

  const leads = leadPanes(allPanes);
  const leadAddresses = new Set([...leads.values()].map((lead) => lead.terminal));
  const jobs = [
    ...[...leads]
      .filter(([tab, lead]) => !named(tabs.get(tab), lead))
      .map(([tab, lead]) => ({
        keys: kids.has(lead.terminal) ? [tab, lead.terminal] : [tab],
        address: lead.terminal,
        source: lead,
      })),
    ...[...kids.values()]
      .filter((k) => !leadAddresses.has(k.address))
      .map((k) => ({ keys: [k.address], address: k.address, source: paneOf.get(k.address) ?? k })),
  ];
  const save = (keys, value) =>
    setShared("task.titles", {
      ...shared("task.titles"),
      ...Object.fromEntries(keys.map((k) => [k, value])),
    });

  let budget = 8;
  for (const { keys, address, source } of jobs) {
    if (!source.program?.agent || budget <= 0) continue;
    const turn = turns.get(address) ?? 0;
    const old = (shared("task.titles") ?? {})[keys[0]];
    const now = Date.now();
    // A resumed session can report 0 turns.
    const started = turn >= 1 || Boolean(liveTitle(source));
    if (!titleDue(old, turn, started, now)) continue;
    budget--;
    let titles = null,
      key = old?.key ?? null;
    try {
      const screen = await exec("hc", ["read", address, "--lines", "150"]);
      if (screen.code === 0) {
        const { input, key: newKey } = await titleInput(screen.stdout, address);
        if (newKey === NO_PROMPTS) continue;
        const unchanged =
          old?.text && old.key === newKey && old.v === TITLE_VERSION && !badShort(old.short ?? "");
        if (unchanged) {
          save(keys, { ...old, turn, at: now });
          continue;
        }
        key = newKey;
        const result = await exec(bin("lasso-title"), [input]);
        if (result.code === 0) titles = parseTitles(result.stdout);
      }
    } catch {}
    // A failure keeps the old title and stamps `at`, so the next try waits RETRY_AFTER.
    save(
      keys,
      titles
        ? { text: titles.long, short: titles.short, turn, at: now, v: TITLE_VERSION, key }
        : { ...old, at: now, v: TITLE_VERSION },
    );
  }
}
