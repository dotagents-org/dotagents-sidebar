import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const { codexHome, readRollouts, findCodexSessions, pending, find, discover } = createRequire(import.meta.url)("../../src/sessions/codex-sessions.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));

// A rollout as Codex writes it: a file in the day folder of its local start time, the first line
// holding the conversation's id, folder and time
function rollout(home, { id, cwd, started }) {
  const day = new Date(started);
  const two = (n) => String(n).padStart(2, "0");
  const dir = path.join(home, "sessions", String(day.getFullYear()), two(day.getMonth() + 1), two(day.getDate()));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}T${two(day.getHours())}-${two(day.getMinutes())}-${two(day.getSeconds())}-${id}.jsonl`);
  const meta = { type: "session_meta", payload: { id, cwd, timestamp: new Date(started).toISOString(), instructions: "x".repeat(20000) } };
  fs.writeFileSync(file, `${JSON.stringify(meta)}\n{"type":"event_msg"}\n`);
  fs.utimesSync(file, started / 1000, started / 1000);
  return file;
}

test("the Codex home is CODEX_HOME, else ~/.codex", () => {
  assert.equal(codexHome({ CODEX_HOME: "/x/codex" }), "/x/codex");
  assert.equal(codexHome({}), path.join(os.homedir(), ".codex"));
});

test("readRollouts reads the id, folder and start time of the rollouts modified since a time", () => {
  const home = tmp();
  const now = Date.now();
  rollout(home, { id: "aaa-1", cwd: "/work/a", started: now - 60000 });
  rollout(home, { id: "old-1", cwd: "/work/a", started: now - 3600000 });
  const bad = rollout(home, { id: "bad-1", cwd: "/work/a", started: now - 30000 });
  fs.writeFileSync(bad, "not json\n");
  fs.writeFileSync(path.join(path.dirname(bad), "notes.txt"), "x");
  const found = readRollouts(home, now - 120000);
  assert.deepEqual(found.map((r) => [r.id, r.cwd, r.started]), [["aaa-1", "/work/a", now - 60000]]);
  assert.deepEqual(readRollouts(path.join(home, "none"), now - 1000), []);
});

test("findCodexSessions gives each session the first rollout in its folder that started after it, once", () => {
  const rollouts = [
    { id: "r1", cwd: "/a", started: 1100 },
    { id: "r2", cwd: "/b", started: 1200 },
    { id: "r3", cwd: "/a", started: 1300 },
    { id: "r0", cwd: "/a", started: 900 }, // before any session: someone else's
  ];
  const pending = [
    { id: "s2", cwd: "/a", startedAt: 1250 },
    { id: "s1", cwd: "/a", startedAt: 1000 },
    { id: "s3", cwd: "/c", startedAt: 1000 },
    { id: "s4", cwd: "/b", startedAt: 1300 }, // r2 came before it
  ];
  assert.deepEqual(findCodexSessions(pending, rollouts), { s1: "r1", s2: "r3" });
  assert.deepEqual(findCodexSessions([], rollouts), {});
});

test("find filters pending sessions and conversations already taken by any agent", () => {
  const sessions = [
    { id: "claude", startedAt: 1000, cwd: "/a" },
    { id: "terminal", kind: "terminal", startedAt: 1000, cwd: "/a" },
    { id: "owned", conversation: "taken" },
    { id: "codex-owned", provider: "codex", conversation: "codex-taken", startedAt: 1000, cwd: "/a" },
    { id: "no-clock", provider: "codex", cwd: "/a" },
    { id: "no-folder", provider: "codex", startedAt: 1000 },
    { id: "s2", provider: "codex", startedAt: 1100, cwd: "/a" },
    { id: "s1", provider: "codex", startedAt: 1000, cwd: "/a" },
  ];
  const rollouts = [
    { id: "taken", cwd: "/a", started: 1001 },
    { id: "codex-taken", cwd: "/a", started: 1002 },
    { id: "r2", cwd: "/a", started: 1200 },
    { id: "r1", cwd: "/a", started: 1100 },
  ];
  const before = structuredClone({ sessions, rollouts });
  assert.deepEqual(pending(sessions).map((s) => s.id), ["s2", "s1"]);
  assert.deepEqual(find(sessions, rollouts), { s1: "r1", s2: "r2" });
  assert.deepEqual({ sessions, rollouts }, before);
  assert.deepEqual(find([], rollouts), {});
  assert.deepEqual(discover([]), {});
});
