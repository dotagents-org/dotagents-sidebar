// The sessions of the view: which agents are open, how they are grouped and which one shows.
// Every action takes a state and returns the new one; the state is what gets saved and drawn

const drag = require("./media/drag.js");

const EMPTY = { sessions: [], active: null, next: 1 };

// The colors a session can take: the terminal panel's (the theme's ANSI colors but the bright
// ones, getStandardColors in VS Code), in its order. A new session takes, among those that stand
// out on dark and light themes alike, the one the open sessions use least, so they are easy to
// tell apart
const COLORS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const ROTATION = ["blue", "green", "yellow", "magenta", "cyan", "red"];

// A terminal session has kind "terminal"; an agent session has none
function create(state, name, group, kind) {
  const id = `s${state.next}`;
  const uses = (c) => state.sessions.filter((s) => s.color === c).length;
  const color = ROTATION.reduce((best, c) => (uses(c) < uses(best) ? c : best));
  const session = { id, name, color, group: group || id, ...(kind ? { kind } : {}) };
  return { session, next: state.next + 1 };
}

function add(state, name, kind) {
  const { session, next } = create(state, name, undefined, kind);
  return { sessions: [...state.sessions, session], active: session.id, next };
}

// The new session joins the active one's group, right after it
function split(state, name, kind) {
  const at = state.sessions.findIndex((s) => s.id === state.active);
  if (at < 0) return add(state, name, kind);
  const { session, next } = create(state, name, state.sessions[at].group, kind);
  const sessions = [...state.sessions.slice(0, at + 1), session, ...state.sessions.slice(at + 1)];
  return { sessions, active: session.id, next };
}

function close(state, id) {
  const at = state.sessions.findIndex((s) => s.id === id);
  if (at < 0) return state;
  const sessions = state.sessions.filter((s) => s.id !== id);
  if (state.active !== id) return { ...state, sessions };
  // The focus stays in the split when there is one (the session before, else the one after), else
  // goes to the next session, or the one before when it was the last
  const group = state.sessions[at].group;
  const mate = [sessions[at - 1], sessions[at]].find((s) => s && s.group === group);
  return { ...state, sessions, active: (mate || sessions[at] || sessions[at - 1] || { id: null }).id };
}

function change(state, id, fields) {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...fields } : s)) };
}

// What the view learns about a session's agent: the conversation it is in, when it started
function remember(state, id, fields) {
  return change(state, id, fields);
}

// Dropping a session on another, or below the last one, as the terminal panel's tabs do it
// (media/drag.js): its group moves next to the other's group, or inside its own group the
// session is reordered. The session that was moved becomes the active one, as there
function drop(state, id, targetId) {
  const sessions = drag.dropOrder(state.sessions, id, targetId);
  return sessions === state.sessions ? state : { ...state, sessions, active: id };
}

function dropEnd(state, id) {
  const sessions = drag.endOrder(state.sessions, id);
  return sessions === state.sessions ? state : { ...state, sessions, active: id };
}

// A session joins another's group (a split), right after it, and becomes the active one
function join(state, id, targetId) {
  const session = state.sessions.find((s) => s.id === id);
  const target = state.sessions.find((s) => s.id === targetId);
  if (!session || !target || id === targetId || session.group === target.group) return state;
  const rest = state.sessions.filter((s) => s.id !== id);
  const at = rest.findIndex((s) => s.id === targetId) + 1;
  return { ...state, sessions: [...rest.slice(0, at), { ...session, group: target.group }, ...rest.slice(at)], active: id };
}

// A session leaves its split and becomes a group of its own, at the end of the list, as in the
// terminal panel (Unsplit Terminal), and becomes the active one
function unsplit(state, id) {
  const session = state.sessions.find((s) => s.id === id);
  if (!session || state.sessions.filter((s) => s.group === session.group).length < 2) return state;
  const rest = state.sessions.filter((s) => s.id !== id);
  return { ...state, sessions: [...rest, { ...session, group: `g${state.next}` }], next: state.next + 1, active: id };
}

function rename(state, id, name) {
  const trimmed = String(name).trim();
  return trimmed ? change(state, id, { name: trimmed }) : state;
}

function recolor(state, id, color) {
  return change(state, id, { color });
}

function activate(state, id) {
  return state.sessions.some((s) => s.id === id) ? { ...state, active: id } : state;
}

// The sessions drawn together: the active one's group
function visible(state) {
  const active = state.sessions.find((s) => s.id === state.active);
  return active ? state.sessions.filter((s) => s.group === active.group) : [];
}

// A state read back from storage
function restore(saved) {
  if (!saved || !Array.isArray(saved.sessions)) return EMPTY;
  // The sessions of a group are neighbors; a state saved by a build that let one move away is put right
  const groups = new Map();
  for (const s of saved.sessions) groups.set(s.group, [...(groups.get(s.group) || []), s]);
  const sessions = [...groups.values()].flat();
  const active = sessions.some((s) => s.id === saved.active) ? saved.active : (sessions[0] || { id: null }).id;
  return { sessions, active, next: saved.next };
}

module.exports = { EMPTY, COLORS, ROTATION, add, split, close, remember, drop, dropEnd, join, unsplit, rename, recolor, activate, visible, restore };
