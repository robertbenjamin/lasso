// The title rules (titles.js). Run: node --test
// titles.js imports Herdr's modules, which node doesn't have, so this loads its source with
// those imports cut out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs
  .readFileSync(new URL("./titles.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "");
const { words, parseTitles, liveTitle, titleDue } = new Function(
  `${src}; return { words, parseTitles, liveTitle, titleDue };`,
)();

test("words and parseTitles", () => {
  assert.equal(words("Herdr UI, auto-run and sandbox", 3), "Herdr UI");
  assert.equal(words("Ruleset split and more things here", 3), "Ruleset split");
  assert.deepEqual(
    parseTitles("Verification email resend | Resend lost candidate verification emails."),
    { short: "Verification email resend", long: "Resend lost candidate verification emails" },
  );
  assert.deepEqual(parseTitles('"ABC-12: Fix PR #7750 thing"'), {
    short: "Fix thing",
    long: "Fix thing",
  });
});

test("liveTitle", () => {
  const claude = { name: "Claude Code", key: "claude" };
  assert.equal(liveTitle({ title: "✳ Fix the login bug", program: claude }), "Fix the login bug");
  assert.equal(liveTitle({ title: "~/code/repo", program: claude }), null);
  assert.equal(liveTitle({ title: "✳ Claude Code", program: claude }), null);
  assert.equal(liveTitle({ title: "x", program: { shell: true } }), null);
});

test("titleDue", () => {
  const now = 1e12,
    min = 60000,
    good = { text: "a", short: "Good title", v: 7, turn: 1 };
  assert.equal(titleDue(null, 1, true, now), true);
  assert.equal(titleDue(null, 0, false, now), false);
  assert.equal(titleDue({ ...good, at: now - 30 * min }, 7, true, now), true); // 6 more turns, 30 min on
  assert.equal(titleDue({ ...good, at: now - 5 * min }, 7, true, now), false); // too soon
  assert.equal(titleDue({ ...good, at: now - 30 * min }, 3, true, now), false); // too few turns
  assert.equal(titleDue({ ...good, v: 6, at: now }, 1, true, now), true); // older rules
  assert.equal(titleDue({ ...good, short: "ABC-12", at: now - 11 * min }, 1, true, now), true); // a bad short title
  assert.equal(titleDue({ at: now - min, v: 7 }, 1, true, now), false); // a failed call waits
});
