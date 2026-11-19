import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it
const { AGENTS, agentOf, terminalCommand, newConversation, command, conversationArgs, env } = createRequire(import.meta.url)("../../src/sessions/agent.js");

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

test("a terminal runs the user's own shell, interactive; bash and PowerShell report their folder", () => {
  assert.deepEqual(terminalCommand("linux", { SHELL: "/bin/bash" }, "/ext"), { file: "/bin/bash", args: ["--rcfile", path.join("/ext", "shell", "bash-cwd.sh"), "-i"] });
  assert.deepEqual(terminalCommand("linux", {}, "/ext"), { file: "bash", args: ["--rcfile", path.join("/ext", "shell", "bash-cwd.sh"), "-i"] });
  assert.deepEqual(terminalCommand("linux", { SHELL: "/bin/zsh" }), { file: "/bin/zsh", args: ["-i"] });
  const win = terminalCommand("win32", { SHELL: "/bin/zsh" });
  assert.equal(win.file, "powershell.exe");
  assert.deepEqual(win.args.slice(0, 3), ["-NoLogo", "-NoExit", "-Command"]);
  assert.match(win.args[3], /\]9;9;/);
});

test("command quotes an argument that isn't plain, for bash and for PowerShell", () => {
  assert.deepEqual(command("linux", claude, ["--settings", "/home/a b/it's.json"]).args, ["-ic", `claude --settings '/home/a b/it'\\''s.json'`]);
  assert.deepEqual(command("win32", claude, ["--settings", "C:\\Users\\a b\\it's.json"]).args, ["-NoLogo", "-Command", `claude --settings 'C:\\Users\\a b\\it''s.json'`]);
  assert.deepEqual(command("linux", codex, ["-c", "a=[1]"]).args, ["-ic", "codex -c 'a=[1]'"]);
});
