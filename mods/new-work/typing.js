// A script that the Task field types by itself, as a person would (the tour uses it).
// Steps: { type: "text" }, { erase: count }, { wait: ms }, { paste: "text" } (it replaces
// all, as select all and paste does). `say` on a step is a note to show as it starts.
// Pure: main.js presses the keys.

const KEY = 28, // one keystroke, ms
  PAUSE = 66, // more, after a word or a comma: people stop there
  BACKSPACE = 24;

// Uneven like a hand, and the same on every run.
const jitter = (index) => ((index * 37) % 24) - 8;

// The keys in order: { insert: "a" }, { erase: true } or { paste: "text" }, `after` ms since
// the one before, the `text` the field holds once it is pressed, and maybe `say`.
export function keys(script, start = "") {
  const out = [];
  let text = start,
    wait = 0;
  let say;
  const press = (key, next, delay) => {
    text = next;
    out.push({ ...key, text, say, after: Math.max(12, delay + jitter(out.length)) + wait });
    wait = 0;
    say = undefined;
  };
  for (const step of script) {
    if (step.wait) wait += step.wait;
    say = step.say;
    if (step.paste) press({ paste: step.paste }, step.paste, PAUSE);
    for (const char of step.type ?? "")
      press({ insert: char }, text + char, / |,/.test(text.at(-1) ?? "") ? PAUSE : KEY);
    for (let left = step.erase ?? 0; left > 0 && text; left--)
      press({ erase: true }, text.slice(0, -1), BACKSPACE);
  }
  return out;
}
