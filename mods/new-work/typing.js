// A script that the Task field types by itself, as a person would (the tour uses it).
// Steps: { type: "text" }, { erase: count }, { wait: ms }. Pure: main.js presses the keys.

const KEY = 26, // one keystroke, ms
  PAUSE = 60, // more, after a word or a comma: people stop there
  BACKSPACE = 22;

// Uneven like a hand, and the same on every run.
const jitter = (index) => ((index * 37) % 24) - 8;

// The keys in order: { insert: "a" } or { erase: true }, `after` ms since the one before, and
// the `text` the field holds once it is pressed.
export function keys(script, start = "") {
  const out = [];
  let text = start,
    wait = 0;
  const press = (key, next, delay) => {
    text = next;
    out.push({ ...key, text, after: Math.max(12, delay + jitter(out.length)) + wait });
    wait = 0;
  };
  for (const step of script) {
    if (step.wait) wait += step.wait;
    for (const char of step.type ?? "")
      press({ insert: char }, text + char, / |,/.test(text.at(-1) ?? "") ? PAUSE : KEY);
    for (let left = step.erase ?? 0; left > 0 && text; left--)
      press({ erase: true }, text.slice(0, -1), BACKSPACE);
  }
  return out;
}
