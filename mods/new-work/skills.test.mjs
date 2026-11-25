import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkills, skillMatches, withSkill } from "./skills.js";

const skills = parseSkills(
  "make-pr\tOpen a PR\nreview-pr\tReview one\nponytail:ponytail-review\tLazy\n",
);

test("the last word, when it starts with /, picks the skills", () => {
  assert.deepEqual(
    skillMatches("/rev", skills).map(([n]) => n),
    ["review-pr", "ponytail:ponytail-review"],
  );
  assert.deepEqual(skillMatches("fix login /make", skills), [["make-pr", "Open a PR"]]);
  assert.equal(skillMatches("/", skills).length, 3);
});

test("no menu inside a link, after a space, or mid-text", () => {
  assert.deepEqual(skillMatches("https://github.com/rev", skills), []);
  assert.deepEqual(skillMatches("/make-pr ", skills), []);
  assert.deepEqual(skillMatches("/make then more", skills), []);
});

test("a pick replaces only the last word", () => {
  assert.equal(withSkill("fix login /ma", "make-pr"), "fix login /make-pr ");
  assert.equal(withSkill("/", "review-pr"), "/review-pr ");
});
