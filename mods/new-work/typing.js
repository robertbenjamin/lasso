// A script that the Task field types by itself, as a person would (the tour uses it).
// Steps: { type: "text" }, { erase: count }, { wait: ms }. Pure: main.js plays the frames.

const KEY = 55, // one keystroke, ms
  PAUSE = 130, // more, after a word or a comma: people stop there
  BACKSPACE = 45;

// Uneven like a hand, and the same on every run.
const jitter = (index) => ((index * 37) % 40) - 10;

// The text after each keystroke, and how long after the one before it shows.
export function frames(script, start = "") {
  const out = [];
  let text = start,
    wait = 0;
  const push = (next, delay) => {
    text = next;
    out.push({ text, after: Math.max(20, delay + jitter(out.length)) + wait });
    wait = 0;
  };
  for (const step of script) {
    if (step.wait) wait += step.wait;
    for (const char of step.type ?? "")
      push(text + char, / |,/.test(text.at(-1) ?? "") ? PAUSE : KEY);
    for (let left = step.erase ?? 0; left > 0 && text; left--) push(text.slice(0, -1), BACKSPACE);
  }
  return out;
}
