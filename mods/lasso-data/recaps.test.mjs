import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecap, latestStep, recapDue, RECAP_VERSION } from "./recaps.js";

test("parseRecap", () => {
  const answer = `Wraps PR titles in the Context panel, now live.

- 2 | "Asked to wrap PR titles like Linear".
9 | Out of range
x | not a step`;
  const prompts = ["hi  there\nmore", "wrap the titles", "c", "pitch some ideas please now ok"];
  assert.deepEqual(
    parseRecap(answer, { times: [100, 200, 300, 400], prompts, uuids: ["u1", "u2"] }),
    {
      summary: "Wraps PR titles in the Context panel, now live",
      steps: [
        { at: 100, text: "Hi there", prompt: "hi there", place: 0, uuid: "u1" },
        {
          at: 200,
          text: "Asked to wrap PR titles like Linear",
          prompt: "wrap the titles",
          place: 1 / 3,
          uuid: "u2",
        },
        {
          at: 400,
          text: "Pitch some ideas please now ok",
          prompt: "pitch some ideas please now ok",
          place: 1,
          uuid: null,
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

test("latestStep", () => {
  const session = { times: [1, 2], prompts: ["first", "second  one\nmore"], uuids: ["u1", "u2"] };
  assert.deepEqual(latestStep(session), {
    at: 2,
    text: "Second one",
    prompt: "second one",
    place: 1,
    uuid: "u2",
  });
  assert.equal(latestStep({ times: [], prompts: [] }), null);
});

test("recapDue", () => {
  const MIN = 60000,
    now = 100 * MIN;
  const working = { turn: 3, status: "working" },
    idle = { turn: 3, status: "done" };
  const due = (old, agent, focused) => recapDue(old, agent, { focused, now });
  const recap = (minutesAgo, turn = 2, v = RECAP_VERSION) => ({
    turn,
    v,
    at: now - minutesAgo * MIN,
  });
  // None yet: the focused agent gets one at once, any other after its turn.
  assert.equal(due(null, working, true), true);
  assert.equal(due(null, working, false), false);
  assert.equal(due(null, idle, false), true);
  // Up to date: nobody.
  assert.equal(due(recap(30, 3), idle, true), false);
  // Behind: the focused agent every 2 minutes, mid-turn too.
  assert.equal(due(recap(1), working, true), false);
  assert.equal(due(recap(2), working, true), true);
  // Behind: any other agent only when idle, every 10 minutes.
  assert.equal(due(recap(30), working, false), false);
  assert.equal(due(recap(5), idle, false), false);
  assert.equal(due(recap(10), idle, false), true);
  // A new recap version counts as behind.
  assert.equal(due(recap(10, 3, RECAP_VERSION - 1), idle, false), true);
});
