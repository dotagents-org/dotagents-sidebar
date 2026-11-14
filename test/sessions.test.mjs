import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { EMPTY, COLORS, ROTATION, add, split, close, rename, recolor, activate, visible, restore } = createRequire(import.meta.url)("../sessions.js");

test("the colors are the terminal panel's, in its order; new sessions take turns among the bright ones", () => {
  assert.deepEqual(COLORS, ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]);
  assert.ok(ROTATION.every((c) => COLORS.includes(c)));
  assert.ok(!ROTATION.includes("black") && !ROTATION.includes("white"));
  let state = EMPTY;
  for (let i = 0; i < ROTATION.length + 1; i++) state = add(state, "A");
  assert.deepEqual(state.sessions.map((s) => s.color), [...ROTATION, ROTATION[0]]);
});

test("a new session takes a color no open session has, or the least used one", () => {
  let state = EMPTY;
  for (let i = 0; i < 3; i++) state = add(state, "A"); // blue, green, yellow
  state = add(close(state, "s2"), "A");
  assert.deepEqual(state.sessions.map((s) => s.color), [ROTATION[0], ROTATION[2], ROTATION[1]]);
  state = recolor(state, "s1", ROTATION[3]);
  assert.equal(add(state, "A").sessions.at(-1).color, ROTATION[0]);
  for (let i = 0; i < ROTATION.length; i++) state = add(state, "A");
  const counts = ROTATION.map((c) => state.sessions.filter((s) => s.color === c).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test("recolor with no color resets the session to the default", () => {
  assert.equal(recolor(add(EMPTY, "A"), "s1", null).sessions[0].color, null);
});

const names = (sessions) => sessions.map((s) => s.id);

test("add opens a session in a group of its own and shows it", () => {
  const one = add(EMPTY, "A");
  const two = add(one, "Claude Code");
  assert.deepEqual(names(two.sessions), ["s1", "s2"]);
  assert.equal(two.active, "s2");
  assert.notEqual(two.sessions[0].group, two.sessions[1].group);
  assert.deepEqual(two.sessions[1], { id: "s2", name: "Claude Code", color: ROTATION[1], group: "s2" });
  assert.deepEqual(names(visible(two)), ["s2"]);
  assert.deepEqual(EMPTY, { sessions: [], active: null, next: 1 });
});

test("split opens a session next to the active one, in its group", () => {
  let state = add(add(EMPTY, "A"), "A");
  state = split(activate(state, "s1"), "Claude Code");
  assert.deepEqual(names(state.sessions), ["s1", "s3", "s2"]);
  assert.equal(state.active, "s3");
  assert.deepEqual(names(visible(state)), ["s1", "s3"]);
  assert.deepEqual(names(visible(activate(state, "s2"))), ["s2"]);
});

test("split with nothing open is the same as add", () => {
  assert.deepEqual(split(EMPTY, "A"), add(EMPTY, "A"));
});

test("close shows the neighbor: the next session, or the previous at the end", () => {
  const three = add(add(add(EMPTY, "A"), "A"), "A");
  assert.equal(close(activate(three, "s2"), "s2").active, "s3");
  assert.equal(close(three, "s3").active, "s2");
  assert.equal(close(three, "s1").active, "s3");
  const none = close(add(EMPTY, "A"), "s1");
  assert.deepEqual(none.sessions, []);
  assert.equal(none.active, null);
  assert.equal(add(none, "A").sessions[0].id, "s2");
});

test("rename and recolor change one session; an empty name is ignored", () => {
  const state = add(add(EMPTY, "A"), "A");
  assert.equal(rename(state, "s1", "  fix login ").sessions[0].name, "fix login");
  assert.equal(rename(state, "s1", "  ").sessions[0].name, "A");
  assert.equal(recolor(state, "s2", "red").sessions[1].color, "red");
  assert.equal(recolor(state, "s2", "red").sessions[0].color, ROTATION[0]);
});

test("activate ignores a session that is not there", () => {
  const state = add(EMPTY, "A");
  assert.equal(activate(state, "s9"), state);
});

test("restore keeps a saved state, and shows the first session when the active one is gone", () => {
  const saved = add(add(EMPTY, "A"), "B");
  const state = restore(saved);
  assert.deepEqual(names(state.sessions), ["s1", "s2"]);
  assert.equal(state.active, "s2");
  assert.equal(state.next, 3);
  assert.equal(restore({ ...saved, active: "s9" }).active, "s1");
  assert.deepEqual(restore(undefined), EMPTY);
  assert.deepEqual(restore({ sessions: "x" }), EMPTY);
});

test("remember keeps facts about one session's agent, and they survive a restore", () => {
  const { remember } = createRequire(import.meta.url)("../sessions.js");
  const state = remember(add(add(EMPTY, "Claude Code"), "Claude Code"), "s1", { conversation: "abc", startedAt: 5 });
  assert.equal(state.sessions[0].conversation, "abc");
  assert.equal(state.sessions[0].startedAt, 5);
  assert.equal(state.sessions[1].conversation, undefined);
  assert.equal(restore(state).sessions[0].conversation, "abc");
});

test("a terminal session is marked as one; an agent session has no kind", () => {
  const state = add(add(EMPTY, "Claude Code"), "Terminal", "terminal");
  assert.equal(state.sessions[0].kind, undefined);
  assert.equal(state.sessions[1].kind, "terminal");
  assert.equal(state.active, "s2");
});
