import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it
const { AGENT, terminalCommand, newConversation, command, conversationArgs, env, newer } = createRequire(import.meta.url)("../agent.js");

test("the agent is Claude Code, with what the view needs", () => {
  for (const key of ["name", "command", "install", "newline"]) assert.equal(typeof AGENT[key], "string", key);
  assert.equal(AGENT.command, "claude");
});

test("command starts claude through the shell that has it on the PATH", () => {
  assert.deepEqual(command("linux"), { file: "bash", args: ["-ic", "claude"] });
  assert.deepEqual(command("darwin"), { file: "bash", args: ["-ic", "claude"] });
  assert.deepEqual(command("win32"), { file: "powershell.exe", args: ["-NoLogo", "-Command", "claude"] });
  assert.deepEqual(command("linux", ["--resume", "abc-1"]), { file: "bash", args: ["-ic", "claude --resume abc-1"] });
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

test("a conversation opens with an id the view chooses, and resumes with it", () => {
  const id = newConversation();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id, newConversation());
  assert.deepEqual(conversationArgs(id, false), ["--session-id", id]);
  assert.deepEqual(conversationArgs(id, true), ["--resume", id]);
});

test("an id that could reach the shell as code is never passed", () => {
  for (const bad of ["x; rm -rf ~", "$(id)", "a b", "`id`", ""]) assert.deepEqual(conversationArgs(bad, true), []);
});

test("a terminal runs the user's own shell, interactive, or PowerShell on Windows", () => {
  assert.deepEqual(terminalCommand("linux", { SHELL: "/bin/zsh" }), { file: "/bin/zsh", args: ["-i"] });
  assert.deepEqual(terminalCommand("linux", {}), { file: "bash", args: ["-i"] });
  assert.deepEqual(terminalCommand("win32", { SHELL: "/bin/zsh" }), { file: "powershell.exe", args: ["-NoLogo"] });
});
