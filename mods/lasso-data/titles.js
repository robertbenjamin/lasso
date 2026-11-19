// Shared state this file writes:
//   task.titles { [tabId | childAddress]: { text, short, turn, at, v, key } }

import { panes, spaces, terminals, shared, setShared, exec } from "herdr";
import { bin, leadPanes, liveTitle, isNamedTab, words, LOOSE_END } from "./lib/shared.js";
import { findTranscript } from "./sessions.js";

const TICKET_ONLY = /^[a-z]{2,6}-\d+$/i;
const RETITLE_TURNS = 10;
const RETITLE_AFTER = 10 * 60000;
const RETRY_AFTER = 10 * 60000;
// Bump when the title rules or bin/lasso-title change: every title is written again once.
const TITLE_VERSION = 7;

export async function readSession(file) {
  const result = await exec(bin("lasso-session"), [file]);
  const prompts = [],
    uuids = [], // the chat row of each prompt, for bin/lasso-reveal
    times = [],
    answers = [],
    replies = []; // replies[i]: the agent's last text after prompt i
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
      if (prompt && !prompt.startsWith("<") && !prompt.startsWith("/")) {
        prompts.push(prompt);
        uuids.push(entry.uuid ?? null);
        times.push(Date.parse(entry.timestamp) || null);
      }
    } else if (entry.type === "assistant" && Array.isArray(content)) {
      const text = content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim();
      if (text && answers.at(-1) !== text) answers.push(text);
      if (text && prompts.length) replies[prompts.length - 1] = text;
    }
  }
  return { prompts, uuids, times, answers, replies, aiTitle };
}

function fingerprint(text) {
  // djb2
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
const NO_PROMPTS = fingerprint("");

export const oneLine = (text, max) => {
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
  const picked = prompts.map((prompt) => oneLine(prompt, 200));
  while (picked.join("\n").length > 3000 && picked.length > 4)
    picked.splice(Math.floor(picked.length / 2), 1);
  const said = [answers[0], answers.length > 1 ? answers.at(-1) : null]
    .filter(Boolean)
    .map((answer) => oneLine(answer, 300));
  return {
    key: fingerprint(prompts.join("\n")),
    input:
      (links.length ? `<links>\n${links.join("\n")}\n</links>\n` : "") +
      `<prompts>\n${picked.map((prompt) => `- ${prompt}`).join("\n")}\n</prompts>` +
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
  if (turn < old.turn) return true; // a restart
  const newTurns = turn - old.turn;
  return newTurns >= RETITLE_TURNS || (newTurns >= 1 && age > RETITLE_AFTER);
}

// At most 8 per run (a call takes 2 to 3 s). A child agent shares its parent's tab, so its
// title is keyed by its address; a child that leads a tab gets both keys.
export async function refreshTitles() {
  const allTerminals = terminals();
  const turns = new Map(allTerminals.map((terminal) => [terminal.address, terminal.turn ?? 0]));
  const kids = new Map(
    allTerminals
      .filter((kid) => kid.parent && kid.state === "live")
      .map((kid) => [kid.address, kid]),
  );
  const allPanes = panes();
  const paneOf = new Map(
    allPanes.filter((pane) => pane.terminal).map((pane) => [pane.terminal, pane]),
  );
  const tabs = new Map(
    spaces()
      .flatMap((space) => space.tabs)
      .map((tab) => [tab.id, tab]),
  );

  // Not while the window has no tabs yet (at start), or every title would go and be written again.
  const live = new Set([...tabs.keys(), ...allTerminals.map((terminal) => terminal.address)]);
  const saved = shared("task.titles") ?? {};
  if (tabs.size && Object.keys(saved).some((key) => !live.has(key)))
    setShared(
      "task.titles",
      Object.fromEntries(Object.entries(saved).filter(([key]) => live.has(key))),
    );

  const leads = leadPanes(allPanes);
  const leadAddresses = new Set([...leads.values()].map((lead) => lead.terminal));
  const jobs = [
    ...[...leads]
      .filter(([tab, lead]) => !isNamedTab(tabs.get(tab), lead))
      .map(([tab, lead]) => ({
        keys: kids.has(lead.terminal) ? [tab, lead.terminal] : [tab],
        address: lead.terminal,
        source: lead,
      })),
    ...[...kids.values()]
      .filter((kid) => !leadAddresses.has(kid.address))
      .map((kid) => ({
        keys: [kid.address],
        address: kid.address,
        source: paneOf.get(kid.address) ?? kid,
      })),
  ];
  const save = (keys, value) =>
    setShared("task.titles", {
      ...shared("task.titles"),
      ...Object.fromEntries(keys.map((key) => [key, value])),
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
