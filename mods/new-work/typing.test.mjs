import { test } from "node:test";
import assert from "node:assert/strict";
import { keys } from "./typing.js";
import { detectModel } from "./models.js";

test("a script types, waits and erases one key at a time", () => {
  const pressed = keys([{ type: "fix" }, { wait: 500 }, { type: " it" }, { erase: 2 }], "> ");
  assert.deepEqual(
    pressed.map((key) => key.text),
    ["> f", "> fi", "> fix", "> fix ", "> fix i", "> fix it", "> fix i", "> fix "],
  );
  assert.deepEqual(
    pressed.map((key) => key.insert ?? "<"),
    ["f", "i", "x", " ", "i", "t", "<", "<"],
  );
  assert.ok(pressed[3].after >= 500);
  assert.ok(pressed.every((key) => key.after >= 12));
});

test("erasing stops at an empty field", () => {
  assert.deepEqual(keys([{ type: "a" }, { erase: 3 }]).at(-1).text, "");
});

test("the model follows a fuzzy name as it is typed", () => {
  const model = (text) => detectModel(text)?.model ?? null;
  assert.equal(model("fix the test with sonet"), "sonnet");
  assert.equal(model("fix the test with hku"), "haiku");
  assert.equal(model("fix the test with"), null);
});

test("a paste replaces all at once and carries its note", () => {
  const pressed = keys([{ type: "ab" }, { paste: "https://x.y/z", say: "Links work too" }]);
  assert.deepEqual(pressed.at(-1).text, "https://x.y/z");
  assert.deepEqual(
    pressed.map((key) => key.say),
    [undefined, undefined, "Links work too"],
  );
});
