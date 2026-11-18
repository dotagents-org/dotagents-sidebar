// Codex conversation discovery and the match to pending sidebar sessions.

const fs = require("fs");
const os = require("os");
const path = require("path");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// Codex saves each conversation as $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, whose
// first line holds the conversation's id, folder and start time (the day folders use local time)
const codexHome = (processEnv = process.env) => processEnv.CODEX_HOME || path.join(os.homedir(), ".codex");

const HEAD_LIMIT = 262144;

function readFirstLine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(8192);
    for (let total = 0; total < HEAD_LIMIT; ) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, total);
      if (!n) break;
      total += n;
      const end = buffer.subarray(0, n).indexOf(10);
      chunks.push(Buffer.from(buffer.subarray(0, end < 0 ? n : end)));
      if (end >= 0) break;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// The rollouts modified since a time, as { id, cwd, started }. A file that can't be read or isn't
// a conversation's is skipped
function readRollouts(home, since) {
  const found = [];
  const list = (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  };
  // The day folders from the day before `since` (a session started near midnight) to today
  const first = new Date(since);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - 1);
  const last = new Date();
  for (let day = first; day <= last; day.setDate(day.getDate() + 1)) {
    const dir = path.join(home, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
    for (const name of list(dir)) {
      if (!/^rollout-.*\.jsonl$/.test(name)) continue;
      try {
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs < since) continue;
        const meta = JSON.parse(readFirstLine(file));
        const { id, cwd, timestamp } = (meta.type === "session_meta" && meta.payload) || {};
        const started = Date.parse(timestamp);
        if (SAFE_ID.test(id || "") && typeof cwd === "string" && started) found.push({ id, cwd, started });
      } catch {
        // unreadable or not a rollout
      }
    }
  }
  return found;
}

// Each Codex session still without a conversation ({ id, cwd, startedAt }) gets the first rollout
// in its folder that started after it and that no other session took: { session id: conversation id }
function findCodexSessions(pending, rollouts) {
  const free = [...rollouts].sort((a, b) => a.started - b.started);
  const found = {};
  for (const session of [...pending].sort((a, b) => a.startedAt - b.startedAt)) {
    const at = free.findIndex((r) => r.cwd === session.cwd && r.started >= session.startedAt);
    if (at < 0) continue;
    found[session.id] = free[at].id;
    free.splice(at, 1);
  }
  return found;
}

const pending = (sessions) => sessions.filter((s) => s.provider === "codex" && !s.conversation && s.startedAt && s.cwd);

// Match only pending Codex sessions, excluding conversations already owned by any session.
function find(sessions, rollouts) {
  const taken = new Set(sessions.map((s) => s.conversation));
  return findCodexSessions(pending(sessions), rollouts.filter((r) => !taken.has(r.id)));
}

function discover(sessions) {
  const waiting = pending(sessions);
  if (!waiting.length) return {};
  return find(sessions, readRollouts(codexHome(), Math.min(...waiting.map((s) => s.startedAt))));
}

module.exports = { codexHome, readRollouts, findCodexSessions, pending, find, discover };
