import { test } from "node:test";
import assert from "node:assert/strict";
import { frames } from "./typing.js";
import { detectModel } from "./models.js";

test("a script types, waits and erases one key at a time", () => {
  const played = frames([{ type: "fix" }, { wait: 500 }, { type: " it" }, { erase: 2 }], "> ");
  assert.deepEqual(
    played.map((frame) => frame.text),
    ["> f", "> fi", "> fix", "> fix ", "> fix i", "> fix it", "> fix i", "> fix "],
  );
  assert.ok(played[3].after >= 500);
  assert.ok(played.every((frame) => frame.after >= 20));
});

test("erasing stops at an empty field", () => {
  assert.deepEqual(frames([{ type: "a" }, { erase: 3 }]).at(-1).text, "");
});

test("the model follows a fuzzy name as it is typed", () => {
  const model = (text) => detectModel(text)?.model ?? null;
  assert.equal(model("fix the test with sonet"), "sonnet");
  assert.equal(model("fix the test with hku"), "haiku");
  assert.equal(model("fix the test with"), null);
});
