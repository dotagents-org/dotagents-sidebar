import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it
const { PROVIDERS, command, env, newer } = createRequire(import.meta.url)("../providers.js");

test("every provider has what the view needs", () => {
  assert.ok(PROVIDERS.length > 0);
  for (const p of PROVIDERS) {
    for (const key of ["id", "name", "command", "install"]) assert.equal(typeof p[key], "string", `${p.id}.${key}`);
  }
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length);
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["opencode", "claude", "codex"]);
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
