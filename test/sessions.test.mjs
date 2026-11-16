import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { EMPTY, COLORS, ROTATION, add, split, close, drop, dropEnd, join, unsplit, rename, recolor, activate, visible, restore } = createRequire(import.meta.url)("../sessions.js");

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

// s1 s2 s5 s3 s4, where s2 and s5 are a split
function five() {
  let state = EMPTY;
  for (let i = 0; i < 4; i++) state = add(state, "A");
  return split(activate(state, "s2"), "A");
}
const ids = (s) => s.sessions.map((x) => x.id);

test("dropping a session on another moves its whole group next to the other's group, as the terminal tabs do", () => {
  const state = five(); // s1 [s2 s5] s3 s4: s2 and s5 are a split
  assert.deepEqual(ids(state), ["s1", "s2", "s5", "s3", "s4"]);
  // the group was before the target: it goes after the target's group
  assert.deepEqual(ids(drop(state, "s2", "s3")), ["s1", "s3", "s2", "s5", "s4"]);
  assert.deepEqual(ids(drop(state, "s5", "s4")), ["s1", "s3", "s4", "s2", "s5"]); // dragging a member moves the group
  // the group was after: it goes before the target's group
  assert.deepEqual(ids(drop(state, "s4", "s2")), ["s1", "s4", "s2", "s5", "s3"]);
  assert.deepEqual(ids(drop(state, "s3", "s1")), ["s3", "s1", "s2", "s5", "s4"]);
  // onto a member of another group means that whole group
  assert.deepEqual(ids(drop(state, "s1", "s5")), ["s2", "s5", "s1", "s3", "s4"]);
  const moved = drop(state, "s2", "s4");
  assert.equal(moved.active, "s2"); // the session that was moved is the one in view
  assert.equal(moved.next, state.next);
  assert.deepEqual(names(visible(activate(moved, "s5"))), ["s2", "s5"]); // the split is intact
});

test("dropping on a member of its own group reorders inside the group", () => {
  let state = EMPTY;
  for (let i = 0; i < 2; i++) state = add(state, "A"); // s1 s2
  state = split(activate(state, "s1"), "A"); // s1 s3 | s2
  state = split(activate(state, "s3"), "A"); // s1 s3 s4 | s2
  assert.deepEqual(ids(state), ["s1", "s3", "s4", "s2"]);
  assert.deepEqual(ids(drop(state, "s1", "s4")), ["s3", "s4", "s1", "s2"]); // dragged down: after the target
  assert.deepEqual(ids(drop(state, "s4", "s1")), ["s4", "s1", "s3", "s2"]); // dragged up: before it
  assert.equal(drop(state, "s1", "s1"), state);
});

test("drop and dropEnd change nothing when the list would stay as it is, or a session is not there", () => {
  const state = five();
  assert.equal(drop(state, "s9", "s1"), state);
  assert.equal(drop(state, "s1", "s9"), state);
  assert.equal(drop(state, "s2", "s2"), state);
  assert.equal(dropEnd(state, "s4"), state); // already last
  assert.deepEqual(ids(dropEnd(state, "s1")), ["s2", "s5", "s3", "s4", "s1"]);
  assert.deepEqual(ids(dropEnd(state, "s5")), ["s1", "s3", "s4", "s2", "s5"]); // the whole group
});

test("unsplit gives a session a group of its own, at the end of the list", () => {
  const state = five();
  const alone = unsplit(state, "s2"); // s1 s5 s3 s4 s2
  assert.deepEqual(ids(alone), ["s1", "s5", "s3", "s4", "s2"]);
  const group = (s, id) => s.sessions.find((x) => x.id === id).group;
  assert.notEqual(group(alone, "s2"), group(alone, "s5"));
  assert.equal(new Set(alone.sessions.map((s) => s.group)).size, 5); // no group name is used twice
  assert.deepEqual(names(visible(activate(alone, "s5"))), ["s5"]);
  assert.equal(unsplit(state, "s1"), state); // not in a split: nothing to leave
  assert.equal(unsplit(state, "s9"), state);
  assert.equal(alone.next, state.next + 1);
  assert.equal(alone.active, "s2"); // in view, alone
});

test("a drop that changes nothing leaves the active session where it was", () => {
  const state = activate(five(), "s3");
  assert.equal(drop(state, "s2", "s2"), state);
  assert.equal(dropEnd(state, "s4"), state);
  assert.equal(dropEnd(state, "s1").active, "s1");
});

test("a split is a session of the kind asked for, beside the active one", () => {
  let state = add(EMPTY, "Terminal", "terminal"); // s1, a terminal
  state = split(state, "Terminal", "terminal");
  assert.deepEqual(state.sessions.map((s) => s.kind), ["terminal", "terminal"]);
  assert.equal(state.sessions[1].group, state.sessions[0].group);
  assert.equal(split(EMPTY, "Terminal", "terminal").sessions[0].kind, "terminal"); // nothing active: a new one
  assert.equal(split(add(EMPTY, "A"), "A").sessions[1].kind, undefined); // an agent beside an agent
});

test("closing the active session keeps the focus in its split", () => {
  const state = five(); // s1 [s2 s5] s3 s4
  assert.equal(close(activate(state, "s5"), "s5").active, "s2"); // the last of the split: its mate, not s3
  assert.equal(close(activate(state, "s2"), "s2").active, "s5"); // the first: the next mate
  let three = split(activate(state, "s5"), "A"); // s1 [s2 s5 s6] s3 s4
  assert.equal(close(activate(three, "s5"), "s5").active, "s2"); // the one before, when there is one
  assert.equal(close(activate(state, "s1"), "s1").active, "s2"); // alone: the next, as before
  assert.equal(close(activate(state, "s4"), "s4").active, "s3"); // alone and last: the one before
  assert.equal(close(activate(state, "s3"), "s3").active, "s4");
  assert.equal(close(activate(state, "s3"), "s5").active, "s3"); // another session closed: unchanged
});

test("restore puts the sessions of a group back together", () => {
  const saved = { sessions: [{ id: "s1", group: "a" }, { id: "s2", group: "b" }, { id: "s3", group: "a" }], active: "s1", next: 4 };
  assert.deepEqual(ids(restore(saved)), ["s1", "s3", "s2"]);
});

test("join puts a session in another's group, right after it, and leaves its old group", () => {
  const state = five();
  const joined = join(state, "s4", "s2"); // s1 s2 s4 s5 s3
  assert.deepEqual(ids(joined), ["s1", "s2", "s4", "s5", "s3"]);
  const group = (s, id) => s.sessions.find((x) => x.id === id).group;
  assert.equal(group(joined, "s4"), group(state, "s2"));
  assert.equal(group(joined, "s5"), group(state, "s2")); // the others keep theirs
  assert.deepEqual(names(visible(activate(joined, "s2"))), ["s2", "s4", "s5"]); // they show together
  assert.equal(joined.active, "s4"); // and it is the one in view, with its new split
  // leaving a split takes one session out of it; the rest stay together
  const left = join(state, "s5", "s1");
  assert.deepEqual(ids(left), ["s1", "s5", "s2", "s3", "s4"]);
  assert.deepEqual(names(visible(activate(left, "s2"))), ["s2"]);
});

test("join changes nothing for itself, a session that is not there, or one already in that group", () => {
  const state = five();
  assert.equal(join(state, "s2", "s2"), state);
  assert.equal(join(state, "s9", "s1"), state);
  assert.equal(join(state, "s1", "s9"), state);
  assert.equal(join(state, "s5", "s2"), state);
});

test("a Codex session has the provider; a Claude Code one has none, so saved sessions keep opening", () => {
  let state = add(EMPTY, "Claude Code");
  state = add(state, "Codex", undefined, "codex");
  assert.equal(state.sessions[0].provider, undefined);
  assert.deepEqual(state.sessions[1], { id: "s2", name: "Codex", color: ROTATION[1], group: "s2", provider: "codex" });
  state = split(state, "Codex", undefined, "codex");
  assert.equal(state.sessions[2].provider, "codex");
  assert.equal(state.sessions[2].group, "s2");
  state = split(add(EMPTY, "Terminal", "terminal"), "Claude Code", undefined, "claude");
  assert.equal("provider" in state.sessions[1], false);
  // A state saved before Codex restores as it was
  const saved = { sessions: [{ id: "s1", name: "Claude Code", color: "blue", group: "s1", conversation: "abc" }], active: "s1", next: 2 };
  assert.deepEqual(restore(saved).sessions, saved.sessions);
});
