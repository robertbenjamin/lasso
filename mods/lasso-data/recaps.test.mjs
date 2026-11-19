import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecap } from "./recaps.js";

test("parseRecap", () => {
  const answer = `Wraps PR titles in the Context panel, now live.

1 | Asked to wrap PR titles like Linear
- 3 | "Pitched five polish ideas".
9 | Out of range
x | not a step`;
  assert.deepEqual(
    parseRecap(answer, {
      times: [100, 200, 300],
      prompts: ["wrap  the\ntitles", "b", "pitch ideas"],
    }),
    {
      summary: "Wraps PR titles in the Context panel, now live",
      steps: [
        { at: 100, text: "Asked to wrap PR titles like Linear", prompt: "wrap the" },
        { at: 300, text: "Pitched five polish ideas", prompt: "pitch ideas" },
        { at: null, text: "Out of range", prompt: undefined },
      ],
    },
  );
  assert.equal(parseRecap("", { times: [], prompts: [] }), null);
});
