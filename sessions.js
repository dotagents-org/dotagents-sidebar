// The sessions of the view: which agents are open, how they are grouped and which one shows.
// Every action takes a state and returns the new one; the state is what gets saved and drawn

const EMPTY = { sessions: [], active: null, next: 1 };

// Names of the terminal's ANSI colors, handed out in turn so sessions are easy to tell apart
const COLORS = ["blue", "green", "yellow", "magenta", "cyan", "red"];

function create(state, provider, name, group) {
  const id = `s${state.next}`;
  const session = { id, provider, name, color: COLORS[(state.next - 1) % COLORS.length], group: group || id };
  return { session, next: state.next + 1 };
}

function add(state, provider, name) {
  const { session, next } = create(state, provider, name);
  return { sessions: [...state.sessions, session], active: session.id, next };
}

// The new session joins the active one's group, right after it
function split(state, provider, name) {
  const at = state.sessions.findIndex((s) => s.id === state.active);
  if (at < 0) return add(state, provider, name);
  const { session, next } = create(state, provider, name, state.sessions[at].group);
  const sessions = [...state.sessions.slice(0, at + 1), session, ...state.sessions.slice(at + 1)];
  return { sessions, active: session.id, next };
}

function close(state, id) {
  const at = state.sessions.findIndex((s) => s.id === id);
  if (at < 0) return state;
  const sessions = state.sessions.filter((s) => s.id !== id);
  const active = state.active !== id ? state.active : (sessions[at] || sessions[at - 1] || { id: null }).id;
  return { ...state, sessions, active };
}

function change(state, id, fields) {
  return { ...state, sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...fields } : s)) };
}

// What the view learns about a session's agent: the conversation it is in, when it started
function remember(state, id, fields) {
  return change(state, id, fields);
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

// A state read back from storage: only sessions of agents that still exist
function restore(saved, providers) {
  if (!saved || !Array.isArray(saved.sessions)) return EMPTY;
  const sessions = saved.sessions.filter((s) => providers.includes(s.provider));
  const active = sessions.some((s) => s.id === saved.active) ? saved.active : (sessions[0] || { id: null }).id;
  return { sessions, active, next: saved.next };
}

module.exports = { EMPTY, COLORS, add, split, close, remember, rename, recolor, activate, visible, restore };
