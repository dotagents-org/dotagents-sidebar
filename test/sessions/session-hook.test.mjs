import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const hook = createRequire(import.meta.url)("../../src/sessions/session-hook.js");
const { AGENTS } = createRequire(import.meta.url)("../../src/sessions/agent.js");

const told = { session_id: "abc-1", transcript_path: "/home/u/.codex/sessions/rollout-abc-1.jsonl", cwd: "/work/ção", source: "clear" };

test("Claude Code gets the hook in a settings file; on Windows it runs in PowerShell", () => {
  assert.deepEqual(hook.claudeSettings("linux"), { hooks: { SessionStart: [{ hooks: [{ type: "command", command: hook.POSIX }] }] } });
  assert.deepEqual(hook.claudeSettings("win32").hooks.SessionStart[0].hooks[0], { type: "command", shell: "powershell", command: hook.POWERSHELL });
  assert.deepEqual(hook.args("linux", AGENTS.claude, "/s/claude.json"), ["--settings", "/s/claude.json"]);
});

test("Codex gets the hook as a config override, with no double quotes on Windows", () => {
  assert.deepEqual(hook.args("linux", AGENTS.codex), ["-c", hook.codexOverride("linux")]);
  assert.equal(hook.codexOverride("linux"), `hooks.SessionStart=[{hooks=[{type="command",command=${JSON.stringify(hook.POSIX)}}]}]`);
  // PowerShell 5.1 drops the double quotes inside an argument, and a TOML literal string holds no single quote
  assert.doesNotMatch(hook.codexOverride("win32"), /"/);
  assert.doesNotMatch(hook.POWERSHELL, /['"]/);
  assert.equal(hook.codexOverride("win32"), `hooks.SessionStart=[{hooks=[{type='command',command='${hook.POWERSHELL}'}]}]`);
});

test("the POSIX hook writes what the agent sends to the session's file, and does nothing without one", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-hook-"));
  try {
    const file = path.join(dir, "s1.json");
    const run = (env) => spawnSync("sh", ["-c", hook.POSIX], { input: JSON.stringify(told), env: { PATH: process.env.PATH, ...env } });
    assert.equal(run({ [hook.VARIABLE]: file }).status, 0);
    assert.deepEqual(hook.read(file), { conversation: "abc-1", transcript: told.transcript_path, source: "clear" });
    assert.equal(run({}).status, 0);
    assert.deepEqual(fs.readdirSync(dir), ["s1.json"]);
    assert.equal(run({ [hook.VARIABLE]: path.join(dir, "missing", "s2.json") }).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("read takes only a safe conversation id, and nothing from a missing or half-written file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-hook-"));
  try {
    const file = path.join(dir, "s1.json");
    assert.equal(hook.read(file), undefined);
    fs.writeFileSync(file, '{"session_id":"abc');
    assert.equal(hook.read(file), undefined);
    fs.writeFileSync(file, JSON.stringify({ ...told, session_id: "x; rm -rf ~" }));
    assert.equal(hook.read(file), undefined);
    fs.writeFileSync(file, JSON.stringify({ session_id: "abc-1", transcript_path: null }));
    assert.deepEqual(hook.read(file), { conversation: "abc-1", transcript: undefined, source: undefined });
    hook.forget(file);
    hook.forget(file);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
