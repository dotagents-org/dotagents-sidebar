import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it
const { AGENTS, agentOf, terminalCommand, newConversation, command, conversationArgs, codexHome, readRollouts, findCodexSessions, env, newer } = createRequire(import.meta.url)("../agent.js");

const { claude, codex } = AGENTS;

test("the agents are Claude Code and Codex, with what the view needs; a session without a provider is Claude Code", () => {
  for (const agent of [claude, codex]) for (const key of ["id", "name", "command", "install", "newline"]) assert.equal(typeof agent[key], "string", key);
  assert.equal(claude.command, "claude");
  assert.equal(codex.command, "codex");
  assert.equal(codex.newline, "\n");
  assert.equal(agentOf({}), claude);
  assert.equal(agentOf({ provider: "claude" }), claude);
  assert.equal(agentOf({ provider: "codex" }), codex);
});

test("command starts the agent through the shell that has it on the PATH", () => {
  assert.deepEqual(command("linux", claude), { file: "bash", args: ["-ic", "claude"] });
  assert.deepEqual(command("darwin", claude), { file: "bash", args: ["-ic", "claude"] });
  assert.deepEqual(command("win32", claude), { file: "powershell.exe", args: ["-NoLogo", "-Command", "claude"] });
  assert.deepEqual(command("linux", claude, ["--resume", "abc-1"]), { file: "bash", args: ["-ic", "claude --resume abc-1"] });
  assert.deepEqual(command("linux", codex, ["resume", "abc-1"]), { file: "bash", args: ["-ic", "codex resume abc-1"] });
  assert.deepEqual(command("win32", codex), { file: "powershell.exe", args: ["-NoLogo", "-Command", "codex"] });
});

test("env describes the terminal and drops VS Code's own process variables", () => {
  const result = env({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", VSCODE_PID: "7", VSCODE_IPC_HOOK_CLI: "/sock", TERM: "dumb" });
  assert.deepEqual(result, {
    PATH: "/bin",
    VSCODE_IPC_HOOK_CLI: "/sock",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "vscode",
  });
});

test("newer compares versions by number, not by text", () => {
  assert.equal(newer("0.10.0", "0.9.0"), true);
  assert.equal(newer("1.0.0", "0.9.9"), true);
  assert.equal(newer("0.6.0", "0.6.0"), false);
  assert.equal(newer("0.5.9", "0.6.0"), false);
  assert.equal(newer("1.0", "1.0.0"), false);
});

test("Claude Code opens with an id the view chooses, and resumes with it", () => {
  const id = newConversation();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id, newConversation());
  assert.deepEqual(conversationArgs(claude, id, false), ["--session-id", id]);
  assert.deepEqual(conversationArgs(claude, id, true), ["--resume", id]);
});

test("Codex opens new with no arguments, since it picks its id, and resumes with it", () => {
  const id = "019e5b1a-7c2e-7f10-8a33-2b6d9d0c4e11";
  assert.deepEqual(conversationArgs(codex, undefined, false), []);
  assert.deepEqual(conversationArgs(codex, id, true), ["resume", id]);
});

test("an id that could reach the shell as code is never passed", () => {
  for (const agent of [claude, codex]) {
    for (const bad of ["x; rm -rf ~", "$(id)", "a b", "`id`", ""]) assert.deepEqual(conversationArgs(agent, bad, true), []);
  }
});

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

test("a terminal runs the user's own shell, interactive; bash and PowerShell report their folder", () => {
  assert.deepEqual(terminalCommand("linux", { SHELL: "/bin/bash" }, "/ext"), { file: "/bin/bash", args: ["--rcfile", path.join("/ext", "shell", "bash-cwd.sh"), "-i"] });
  assert.deepEqual(terminalCommand("linux", {}, "/ext"), { file: "bash", args: ["--rcfile", path.join("/ext", "shell", "bash-cwd.sh"), "-i"] });
  assert.deepEqual(terminalCommand("linux", { SHELL: "/bin/zsh" }), { file: "/bin/zsh", args: ["-i"] });
  const win = terminalCommand("win32", { SHELL: "/bin/zsh" });
  assert.equal(win.file, "powershell.exe");
  assert.deepEqual(win.args.slice(0, 3), ["-NoLogo", "-NoExit", "-Command"]);
  assert.match(win.args[3], /\]9;9;/);
});
