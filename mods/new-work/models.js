// Strongest first. `id` is the claude CLI alias, so it follows the newest version.
export const MODELS = [
  { id: "fable", name: "Fable", version: "5.2" },
  { id: "opus", name: "Opus", version: "5.5" },
  { id: "sonnet", name: "Sonnet", version: "5.5" },
  { id: "haiku", name: "Haiku", version: "5.5" },
];

// Everyday words that are also abbreviations of a model ("so" -> sonnet, "hi" -> haiku).
const WORDS = new Set([
  "so",
  "se",
  "set",
  "st",
  "sot",
  "soe",
  "os",
  "hi",
  "ha",
  "hu",
  "hau",
  "fa",
  "fe",
  "fae",
  "ops",
]);

const inOrder = (token, name) => {
  let i = 0;
  for (const c of name) if (c === token[i]) i++;
  return i === token.length;
};

function score(token, name) {
  if (token === name) return 3;
  if (name.startsWith(token)) return 2;
  if (token[0] === name[0] && inOrder(token, name)) return 1;
  return 0;
}

// The strongest mention wins, the later one on a tie: "son" -> sonnet, "op" -> opus, "fb" -> fable.
export function detectModel(text) {
  const prose = text.replace(/https?:\/\/\S+/g, " ");
  let best = null;
  for (const m of prose.matchAll(/[A-Za-z]+/g)) {
    const token = m[0].toLowerCase();
    if (token.length < 2 || WORDS.has(token)) continue;
    for (const model of MODELS) {
      const s = score(token, model.id);
      if (s && (!best || s >= best.score))
        best = { model: model.id, score: s, start: m.index, end: m.index + m[0].length };
    }
  }
  return best;
}

// A mention that opens or closes the text is an instruction to the dialog, not part of the task.
export function withoutModel(text, found) {
  if (!found) return text;
  const lead = /^\s*(use|using|with|on|in|via)?\s*$/i,
    tail = /(\b(use|using|with|on|in|via))?[\s,:;-]*$/i;
  const before = text.slice(0, found.start),
    after = text.slice(found.end).replace(/^[\s-]*\d+(\.\d+)?/, "");
  const rest = lead.test(before)
    ? after.replace(/^[\s,:;.-]+/, "")
    : !after.trim()
      ? before.replace(tail, "")
      : text;
  return rest.trim() ? rest.trim() : text;
}
