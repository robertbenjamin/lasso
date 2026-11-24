import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, world, progress } from "./steps.js";

const cwd = "/Users/me/.herdr/worktrees/lasso-demo/oslo";
const agent = (address, status, more = {}) => ({ address, status, state: "live", cwd, ...more });
const pane = (terminal, title = "") => ({ terminal, title, program: { name: "Claude Code" } });
const step = (id) => STEPS.find((candidate) => candidate.id === id);

test("no demo agent: the tour waits for New work", () => {
  const other = { ...agent("t1", "working"), cwd: "/Users/me/code/api" };
  const now = world([other], [pane("t1")]);
  assert.equal(now.lead, null);
  assert.equal(progress(step("new-work"), now).tone, "you");
});

test("the lead is the demo agent with no parent, and its title ends the title step", () => {
  const terminals = [agent("t1", "idle"), agent("t2", "working", { parent: "t1" })];
  const now = world(terminals, [pane("t1", "Flaky checkout test"), pane("t2")]);
  assert.equal(now.lead.address, "t1");
  assert.equal(now.kids, 1);
  assert.deepEqual(progress(step("title"), now), {
    tone: "ok",
    text: "Named “Flaky checkout test”",
  });
});

test("a blocked child is your turn, and the step ends when everyone has stopped", () => {
  const panes = [pane("t1"), pane("t2"), pane("t3")];
  const kids = (second) => [
    agent("t1", "working"),
    agent("t2", "idle", { parent: "t1" }),
    agent("t3", second, { parent: "t1" }),
  ];
  assert.equal(progress(step("children"), world(kids("blocked"), panes)).tone, "you");
  assert.equal(progress(step("children"), world(kids("working"), panes)).tone, "busy");
  const settled = kids("idle").map((terminal) => ({ ...terminal, status: "done" }));
  assert.equal(progress(step("children"), world(settled, panes)).tone, "ok");
});
