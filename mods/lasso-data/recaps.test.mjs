import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecap } from "./recaps.js";

test("parseRecap", () => {
  const answer = `Wraps PR titles in the Context panel, now live.

- 2 | "Asked to wrap PR titles like Linear".
9 | Out of range
x | not a step`;
  const prompts = ["hi  there\nmore", "wrap the titles", "c", "pitch some ideas please now ok"];
  assert.deepEqual(
    parseRecap(answer, { times: [100, 200, 300, 400], prompts, replies: ["", " Wrapped. "] }),
    {
      summary: "Wraps PR titles in the Context panel, now live",
      steps: [
        { at: 100, text: "hi there", prompt: "hi there", place: 0, reply: "" },
        {
          at: 200,
          text: "Asked to wrap PR titles like Linear",
          prompt: "wrap the titles",
          place: 1 / 3,
          reply: "Wrapped.",
        },
        {
          at: 400,
          text: "pitch some ideas please now ok",
          prompt: "pitch some ideas please now ok",
          place: 1,
          reply: "",
        },
      ],
    },
  );
  assert.equal(parseRecap("", { times: [], prompts: [] }), null);
  // Over 5 steps: the first and the latest 4.
  const many = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  const lots = parseRecap(`S\n${many.map((p, i) => `${i + 1} | step ${i + 1}`).join("\n")}`, {
    times: [],
    prompts: many,
  });
  assert.deepEqual(
    lots.steps.map((step) => step.text),
    ["step 1", "step 5", "step 6", "step 7", "step 8"],
  );
});
