import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// The same file the view loads as a script
const { groups, dropOrder, endOrder, moving, plan, planEnd } = createRequire(import.meta.url)("../../src/shared/drag.js");

// s1 [s2 s3] s4 [s5 s6]: s2+s3 and s5+s6 are splits
const sessions = [
  { id: "s1", group: "a" },
  { id: "s2", group: "b" },
  { id: "s3", group: "b" },
  { id: "s4", group: "c" },
  { id: "s5", group: "d" },
  { id: "s6", group: "d" },
];
const ids = (list) => list.map((s) => s.id).join(" ");

test("the list is a run of groups: neighbors that share one", () => {
  assert.deepEqual(groups(sessions).map((g) => g.map((s) => s.id)), [["s1"], ["s2", "s3"], ["s4"], ["s5", "s6"]]);
  assert.deepEqual(groups([]), []);
});

test("a drop moves the whole group, after the target's group when it was before and before it when after", () => {
  assert.equal(ids(dropOrder(sessions, "s1", "s4")), "s2 s3 s4 s1 s5 s6"); // down: after
  assert.equal(ids(dropOrder(sessions, "s4", "s1")), "s4 s1 s2 s3 s5 s6"); // up: before
  assert.equal(ids(dropOrder(sessions, "s2", "s4")), "s1 s4 s2 s3 s5 s6"); // a member drags its group
  assert.equal(ids(dropOrder(sessions, "s3", "s6")), "s1 s4 s5 s6 s2 s3");
  assert.equal(ids(dropOrder(sessions, "s5", "s1")), "s5 s6 s1 s2 s3 s4");
  assert.equal(ids(dropOrder(sessions, "s1", "s3")), "s2 s3 s1 s4 s5 s6"); // onto a member: that whole group
  assert.equal(ids(dropOrder(sessions, "s1", "s2")), "s2 s3 s1 s4 s5 s6"); // onto the next group: they swap
});

test("a drop inside the group reorders just that session, after the target when dragged down", () => {
  assert.equal(ids(dropOrder(sessions, "s2", "s3")), "s1 s3 s2 s4 s5 s6");
  assert.equal(ids(dropOrder(sessions, "s3", "s2")), "s1 s3 s2 s4 s5 s6");
  assert.equal(ids(dropOrder(sessions, "s6", "s5")), "s1 s2 s3 s4 s6 s5");
});

test("a drop that would change nothing returns the same list", () => {
  assert.equal(dropOrder(sessions, "s2", "s2"), sessions);
  assert.equal(dropOrder(sessions, "s9", "s1"), sessions);
  assert.equal(dropOrder(sessions, "s1", "s9"), sessions);
});

test("below the last session the group goes to the end, unless it is there", () => {
  assert.equal(ids(endOrder(sessions, "s1")), "s2 s3 s4 s5 s6 s1");
  assert.equal(ids(endOrder(sessions, "s3")), "s1 s4 s5 s6 s2 s3");
  assert.equal(endOrder(sessions, "s6"), sessions);
  assert.equal(endOrder(sessions, "s9"), sessions);
});

test("what moves: the whole group, or just the session over its own group's rows; joining is the session alone", () => {
  assert.deepEqual(moving(sessions, "s2", "s4"), ["s2", "s3"]);
  assert.deepEqual(moving(sessions, "s2", "s3"), ["s2"]);
  assert.deepEqual(moving(sessions, "s2", undefined), ["s2", "s3"]); // below the last one
  assert.deepEqual(moving(sessions, "s1", "s4"), ["s1"]);
});

test("the line goes after the target's group when dragging down, before it when dragging up", () => {
  assert.deepEqual(plan(sessions, "s1", "s2").mark, { id: "s3", where: "after" }); // the group's last row
  assert.deepEqual(plan(sessions, "s1", "s3").mark, { id: "s3", where: "after" });
  assert.deepEqual(plan(sessions, "s4", "s3").mark, { id: "s2", where: "before" }); // the group's first row
  assert.deepEqual(plan(sessions, "s6", "s1").mark, { id: "s1", where: "before" });
  assert.deepEqual(plan(sessions, "s2", "s3").mark, { id: "s3", where: "after" }); // inside the group
  assert.deepEqual(plan(sessions, "s3", "s2").mark, { id: "s2", where: "before" });
  assert.deepEqual(plan(sessions, "s1", "s4").message, { type: "drop", id: "s1", target: "s4" });
});

test("a drop that changes nothing has no plan", () => {
  assert.equal(plan(sessions, "s2", "s2"), null);
  assert.equal(plan(sessions, "s9", "s1"), null);
  assert.equal(plan(sessions, "s1", "s9"), null);
});

test("with Shift the session joins the target's group, unless it is already in it", () => {
  const joined = plan(sessions, "s1", "s5", true);
  assert.deepEqual(joined.message, { type: "join", id: "s1", target: "s5" });
  assert.deepEqual(joined.mark, { id: "s5", where: "into" });
  assert.equal(plan(sessions, "s2", "s3", true), null);
  assert.equal(plan(sessions, "s1", "s1", true), null);
  assert.deepEqual(plan(sessions, "s3", "s1", true).message, { type: "join", id: "s3", target: "s1" }); // out of a split too
});

test("below the last session with Shift, a session in a split leaves it, alone at the end", () => {
  assert.deepEqual(planEnd(sessions, "s3", true), { message: { type: "unsplit", id: "s3" }, mark: { id: "s6", where: "after" } });
  assert.deepEqual(planEnd(sessions, "s6", true).message, { type: "unsplit", id: "s6" }); // even when its group is last
  // alone, Shift changes nothing: the same as a plain drop
  assert.deepEqual(planEnd(sessions, "s1", true), planEnd(sessions, "s1", false));
  assert.equal(planEnd([{ id: "s1", group: "a" }], "s1", true), null);
});

test("below the last session, the plan sends the group to the end", () => {
  assert.deepEqual(planEnd(sessions, "s1"), { message: { type: "dropEnd", id: "s1" }, mark: { id: "s6", where: "after" } });
  assert.equal(planEnd(sessions, "s5"), null); // already last
  assert.equal(planEnd([], "s1"), null);
});
