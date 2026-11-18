import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitles, titleDue } from "./titles.js";
import { words, liveTitle } from "./lib/shared.js";

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
  assert.equal(titleDue({ ...good, at: now }, 11, true, now), true); // 10 more turns
  assert.equal(titleDue({ ...good, at: now - 11 * min }, 2, true, now), true); // 1 more turn, 11 min on
  assert.equal(titleDue({ ...good, at: now - 5 * min }, 7, true, now), false); // too soon, too few turns
  assert.equal(titleDue({ ...good, at: now - 30 * min }, 1, true, now), false); // no new turn
  assert.equal(titleDue({ ...good, turn: 9, at: now }, 2, true, now), true); // a restart
  assert.equal(titleDue({ ...good, v: 6, at: now }, 1, true, now), true); // older rules
  assert.equal(titleDue({ ...good, short: "ABC-12", at: now - 11 * min }, 1, true, now), true); // a bad short title
  assert.equal(titleDue({ at: now - min, v: 7 }, 1, true, now), false); // a failed call waits
});
