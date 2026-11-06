// node mods/context/links.check.mjs: fails loudly if the link parsing breaks.
import assert from "node:assert/strict";
import { parse, startLinks } from "./links.js";

assert.deepEqual(parse("https://linear.app/join-com/issue/thu-4399/drop-tables"), { kind: "issue", key: "THU-4399", url: "https://linear.app/join-com/issue/thu-4399" });
assert.equal(parse("https://github.com/join-com/Data/pull/7750/files").key, "join-com/data#7750");
assert.equal(parse("https://github.com/join-com/data/pull/7750/files").url, "https://github.com/join-com/data/pull/7750");
assert.equal(parse("https://join-com.slack.com/archives/CA02AU0EP/p1793370325995259").at, 1793370325000);
assert.equal(parse("https://linear.app/join-com/document/cleanup-backlog-3f2a9c1d8e7b").title, "Cleanup backlog");
assert.equal(parse("https://example.com/x"), null);

// "/make-pr THU-4601": a bare ID; a URL and its own ID count once; lowercase "utf-8" is no ticket.
assert.deepEqual(startLinks("<command-args>THU-4601</command-args>").map((l) => l.key), ["THU-4601"]);
const s = startLinks("https://linear.app/join-com/issue/THU-4399 . PR 2 of 2, see https://join-com.slack.com/archives/C1/p1793370325995259 and THU-4399, utf-8");
assert.deepEqual(s.map((l) => l.kind), ["issue", "slack"]);
console.log("links ok");
