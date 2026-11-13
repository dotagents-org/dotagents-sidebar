import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it
const { PROVIDERS, command, env, newer } = createRequire(import.meta.url)("../providers.js");

test("every provider has what the view needs", () => {
  for (const p of PROVIDERS) {
    for (const key of ["id", "name", "command", "install"]) assert.equal(typeof p[key], "string", `${p.id}.${key}`);
  }
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["claude"]);
});

test("command starts the provider through the shell that has it on the PATH", () => {
  const p = { command: "agent" };
  assert.deepEqual(command(p, "linux"), { file: "bash", args: ["-ic", "agent"] });
  assert.deepEqual(command(p, "darwin"), { file: "bash", args: ["-ic", "agent"] });
  assert.deepEqual(command(p, "win32"), { file: "powershell.exe", args: ["-NoLogo", "-Command", "agent"] });
});

test("env describes the terminal and drops VS Code's own process variables", () => {
  const result = env(
    {},
    { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", VSCODE_PID: "7", VSCODE_IPC_HOOK_CLI: "/sock", TERM: "dumb" }
  );
  assert.deepEqual(result, {
    PATH: "/bin",
    VSCODE_IPC_HOOK_CLI: "/sock",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "vscode",
  });
});

test("env adds the provider's variables without replacing the user's", () => {
  const p = { env: { AGENT_THEME: "system" } };
  assert.equal(env(p, {}).AGENT_THEME, "system");
  assert.equal(env(p, { AGENT_THEME: "mine" }).AGENT_THEME, "mine");
});

test("newer compares versions by number, not by text", () => {
  assert.equal(newer("0.10.0", "0.9.0"), true);
  assert.equal(newer("1.0.0", "0.9.9"), true);
  assert.equal(newer("0.6.0", "0.6.0"), false);
  assert.equal(newer("0.5.9", "0.6.0"), false);
  assert.equal(newer("1.0", "1.0.0"), false);
});

const { conversationArgs } = createRequire(import.meta.url)("../providers.js");
const byId = (id) => PROVIDERS.find((p) => p.id === id);

test("claude opens a conversation with an id the view chooses", () => {
  const claude = byId("claude");
  const id = claude.newConversation();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(conversationArgs(claude, id, false), ["--session-id", id]);
  assert.deepEqual(conversationArgs(claude, id, true), ["--resume", id]);
});

test("an id that could reach the shell as code is never passed", () => {
  for (const bad of ["x; rm -rf ~", "$(id)", "a b", "`id`", ""]) {
    assert.deepEqual(conversationArgs(byId("claude"), bad, true), []);
  }
});

test("command appends the arguments to the agent's command", () => {
  assert.deepEqual(command({ command: "agent" }, "linux", ["--resume", "abc-1"]), { file: "bash", args: ["-ic", "agent --resume abc-1"] });
  assert.deepEqual(command({ command: "agent" }, "win32", ["resume", "x"]), { file: "powershell.exe", args: ["-NoLogo", "-Command", "agent resume x"] });
});
