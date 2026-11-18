// The sessions of the view: which agents are open, how they are grouped and which one shows.
// Every action takes a state and returns the new one; the state is what gets saved and drawn.
// A group of more than one session (a split) has a layout (media/layout.js): how its panes share
// the view. Its leaves are always the group's sessions in the order of the list

const drag = require("./media/drag.js");
const layout = require("./media/layout.js");

const EMPTY = { sessions: [], active: null, next: 1, layouts: {} };

// The colors a session can take: the terminal panel's (the theme's ANSI colors but the bright
// ones, getStandardColors in VS Code), in its order. A new session takes, among those that stand
// out on dark and light themes alike, the one the open sessions use least, so they are easy to
// tell apart
const COLORS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const ROTATION = ["blue", "green", "yellow", "magenta", "cyan", "red"];

// A terminal session has kind "terminal"; an agent session has none. An agent session has the
// provider "codex" or, when it has none, "claude" (the sessions saved before Codex)
function create(state, name, group, kind, provider) {
  const id = `s${state.next}`;
  const uses = (c) => state.sessions.filter((s) => s.color === c).length;
  const color = ROTATION.reduce((best, c) => (uses(c) < uses(best) ? c : best));
  const session = { id, name, color, group: group || id, ...(kind ? { kind } : {}), ...(provider === "codex" ? { provider } : {}) };
  return { session, next: state.next + 1 };
}

// The layouts with `group`'s tree replaced; a tree down to one session (or none) is no layout
function setLayout(layouts, group, tree) {
  const out = { ...layouts };
  if (tree && typeof tree === "object") out[group] = tree;
  else delete out[group];
  return out;
}

const layoutsOf = (state) => state.layouts || {};

// A group's tree, or undefined: only the group's own entry (a group name is never "constructor",
// but a message from the page is checked as if it could be)
const treeOf = (state, group) => (Object.hasOwn(layoutsOf(state), group) ? layoutsOf(state)[group] : undefined);

// Whether `id` can be split again: the new split would sit no deeper than layout.DEPTH
const roomBeside = (tree, id) => !tree || layout.depth(tree, id) <= layout.DEPTH;

// Whether the session `id` can be split (or joined) again
function canSplit(state, id) {
  const session = state.sessions.find((s) => s.id === id);
  return !session || roomBeside(treeOf(state, session.group), id);
}

// The trees after the list was reordered: each group's leaves in the list's new order
function relabel(sessions, layouts) {
  const out = {};
  for (const [group, tree] of Object.entries(layouts)) {
    out[group] = layout.relabel(tree, sessions.filter((s) => s.group === group).map((s) => s.id));
  }
  return out;
}

function add(state, name, kind, provider) {
  const { session, next } = create(state, name, undefined, kind, provider);
  return { ...state, sessions: [...state.sessions, session], active: session.id, next, layouts: layoutsOf(state) };
}

// The new session joins the group of `target` (the active one by default), on the side `dir`
// says: right after it in the list for right and down, right before it for left and up. Nothing
// changes when `target` already sits as deep as a split may go
function split(state, name, kind, provider, dir = "right", target = state.active) {
  const at = state.sessions.findIndex((s) => s.id === target);
  if (at < 0) return add(state, name, kind, provider);
  const { group } = state.sessions[at];
  if (!roomBeside(treeOf(state, group), target)) return state;
  const { session, next } = create(state, name, group, kind, provider);
  const where = dir === "left" || dir === "up" ? at : at + 1;
  const sessions = [...state.sessions.slice(0, where), session, ...state.sessions.slice(where)];
  const tree = layout.insert(layoutsOf(state)[group] || target, target, session.id, dir);
  return { ...state, sessions, active: session.id, next, layouts: setLayout(layoutsOf(state), group, tree) };
}

function close(state, id) {
  const at = state.sessions.findIndex((s) => s.id === id);
  if (at < 0) return state;
  const sessions = state.sessions.filter((s) => s.id !== id);
  const { group } = state.sessions[at];
  const layouts = layoutsOf(state)[group] ? setLayout(layoutsOf(state), group, layout.remove(layoutsOf(state)[group], id)) : layoutsOf(state);
  if (state.active !== id) return { ...state, sessions, layouts };
  // The focus stays in the split when there is one (the session before, else the one after), else
  // goes to the next session, or the one before when it was the last
  const mate = [sessions[at - 1], sessions[at]].find((s) => s && s.group === group);
  return { ...state, sessions, layouts, active: (mate || sessions[at] || sessions[at - 1] || { id: null }).id };
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
  return sessions === state.sessions ? state : { ...state, sessions, active: id, layouts: relabel(sessions, layoutsOf(state)) };
}

function dropEnd(state, id) {
  const sessions = drag.endOrder(state.sessions, id);
  return sessions === state.sessions ? state : { ...state, sessions, active: id, layouts: relabel(sessions, layoutsOf(state)) };
}

// The layouts without `session` in its group's tree
function leave(layouts, session) {
  return layouts[session.group] ? setLayout(layouts, session.group, layout.remove(layouts[session.group], session.id)) : layouts;
}

// A session joins another's group (a split), right after it (to its right), and becomes the active one
function join(state, id, targetId) {
  const session = state.sessions.find((s) => s.id === id);
  const target = state.sessions.find((s) => s.id === targetId);
  if (!session || !target || id === targetId || session.group === target.group) return state;
  if (!roomBeside(treeOf(state, target.group), targetId)) return state;
  const rest = state.sessions.filter((s) => s.id !== id);
  const at = rest.findIndex((s) => s.id === targetId) + 1;
  const layouts = leave(layoutsOf(state), session);
  const tree = layout.insert(layouts[target.group] || targetId, targetId, id, "right");
  return { ...state, sessions: [...rest.slice(0, at), { ...session, group: target.group }, ...rest.slice(at)], active: id, layouts: setLayout(layouts, target.group, tree) };
}

// A session leaves its split and becomes a group of its own, at the end of the list, as in the
// terminal panel (Unsplit Terminal), and becomes the active one
function unsplit(state, id) {
  const session = state.sessions.find((s) => s.id === id);
  if (!session || state.sessions.filter((s) => s.group === session.group).length < 2) return state;
  const rest = state.sessions.filter((s) => s.id !== id);
  return { ...state, sessions: [...rest, { ...session, group: `g${state.next}` }], next: state.next + 1, active: id, layouts: leave(layoutsOf(state), session) };
}

// A border of a split dragged: the split at `path` in `group`'s tree takes `ratio`, when the tree
// still has the shape the border was dragged in (layout.shape)
function resize(state, group, shape, path, ratio) {
  const tree = treeOf(state, group);
  if (!tree || layout.shape(tree) !== shape) return state;
  const next = layout.setRatio(tree, path, ratio);
  return next === tree ? state : { ...state, layouts: setLayout(layoutsOf(state), group, next) };
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
  // A split keeps its saved tree when it still fits its sessions, and the list follows the tree;
  // else (saved before there were trees) its sessions sit side by side in equal parts
  const layouts = {};
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    const ids = members.map((s) => s.id);
    const kept = saved.layouts && typeof saved.layouts === "object" && Object.hasOwn(saved.layouts, group) ? saved.layouts[group] : undefined;
    const tree = layout.valid(kept, ids) || layout.row(ids);
    layouts[group] = tree;
    groups.set(group, layout.leaves(tree).map((id) => members.find((s) => s.id === id)));
  }
  const sessions = [...groups.values()].flat();
  const active = sessions.some((s) => s.id === saved.active) ? saved.active : (sessions[0] || { id: null }).id;
  return { sessions, active, next: saved.next, layouts };
}

module.exports = { EMPTY, COLORS, ROTATION, add, split, canSplit, close, remember, drop, dropEnd, join, unsplit, resize, rename, recolor, activate, visible, restore };
