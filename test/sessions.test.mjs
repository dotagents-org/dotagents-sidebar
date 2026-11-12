import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { EMPTY, COLORS, ROTATION, add, split, close, rename, recolor, activate, visible, restore } = createRequire(import.meta.url)("../sessions.js");

test("the colors are the terminal panel's, in its order; new sessions take turns among the bright ones", () => {
  assert.deepEqual(COLORS, ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]);
  assert.ok(ROTATION.every((c) => COLORS.includes(c)));
  assert.ok(!ROTATION.includes("black") && !ROTATION.includes("white"));
  let state = EMPTY;
  for (let i = 0; i < ROTATION.length + 1; i++) state = add(state, "a", "A");
  assert.deepEqual(state.sessions.map((s) => s.color), [...ROTATION, ROTATION[0]]);
});

test("recolor with no color resets the session to the default", () => {
  assert.equal(recolor(add(EMPTY, "a", "A"), "s1", null).sessions[0].color, null);
});

const names = (sessions) => sessions.map((s) => s.id);

test("add opens a session in a group of its own and shows it", () => {
  const one = add(EMPTY, "opencode", "OpenCode");
  const two = add(one, "claude", "Claude Code");
  assert.deepEqual(names(two.sessions), ["s1", "s2"]);
  assert.equal(two.active, "s2");
  assert.notEqual(two.sessions[0].group, two.sessions[1].group);
  assert.deepEqual(two.sessions[1], { id: "s2", provider: "claude", name: "Claude Code", color: ROTATION[1], group: "s2" });
  assert.deepEqual(names(visible(two)), ["s2"]);
  assert.deepEqual(EMPTY, { sessions: [], active: null, next: 1 });
});

test("split opens a session next to the active one, in its group", () => {
  let state = add(add(EMPTY, "opencode", "OpenCode"), "codex", "Codex");
  state = split(activate(state, "s1"), "claude", "Claude Code");
  assert.deepEqual(names(state.sessions), ["s1", "s3", "s2"]);
  assert.equal(state.active, "s3");
  assert.deepEqual(names(visible(state)), ["s1", "s3"]);
  assert.deepEqual(names(visible(activate(state, "s2"))), ["s2"]);
});

test("split with nothing open is the same as add", () => {
  assert.deepEqual(split(EMPTY, "codex", "Codex"), add(EMPTY, "codex", "Codex"));
});

test("close shows the neighbor: the next session, or the previous at the end", () => {
  const three = add(add(add(EMPTY, "a", "A"), "a", "A"), "a", "A");
  assert.equal(close(activate(three, "s2"), "s2").active, "s3");
  assert.equal(close(three, "s3").active, "s2");
  assert.equal(close(three, "s1").active, "s3");
  const none = close(add(EMPTY, "a", "A"), "s1");
  assert.deepEqual(none.sessions, []);
  assert.equal(none.active, null);
  assert.equal(add(none, "a", "A").sessions[0].id, "s2");
});

test("rename and recolor change one session; an empty name is ignored", () => {
  const state = add(add(EMPTY, "a", "A"), "a", "A");
  assert.equal(rename(state, "s1", "  fix login ").sessions[0].name, "fix login");
  assert.equal(rename(state, "s1", "  ").sessions[0].name, "A");
  assert.equal(recolor(state, "s2", "red").sessions[1].color, "red");
  assert.equal(recolor(state, "s2", "red").sessions[0].color, ROTATION[0]);
});

test("activate ignores a session that is not there", () => {
  const state = add(EMPTY, "a", "A");
  assert.equal(activate(state, "s9"), state);
});

test("restore keeps a saved state and drops what it cannot run", () => {
  const saved = add(add(EMPTY, "opencode", "OpenCode"), "gone", "Gone");
  const state = restore(saved, ["opencode"]);
  assert.deepEqual(names(state.sessions), ["s1"]);
  assert.equal(state.active, "s1");
  assert.equal(state.next, 3);
  assert.deepEqual(restore(undefined, ["opencode"]), EMPTY);
  assert.deepEqual(restore({ sessions: "x" }, ["opencode"]), EMPTY);
});

test("remember keeps facts about one session's agent, and they survive a restore", () => {
  const { remember } = createRequire(import.meta.url)("../sessions.js");
  const state = remember(add(add(EMPTY, "claude", "Claude Code"), "codex", "Codex"), "s1", { conversation: "abc", startedAt: 5 });
  assert.equal(state.sessions[0].conversation, "abc");
  assert.equal(state.sessions[0].startedAt, 5);
  assert.equal(state.sessions[1].conversation, undefined);
  assert.equal(restore(state, ["claude", "codex"]).sessions[0].conversation, "abc");
});
