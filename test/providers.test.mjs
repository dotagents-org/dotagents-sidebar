import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it
const { ALL_PROVIDERS, PROVIDERS, command, env, newer } = createRequire(import.meta.url)("../providers.js");

test("every provider has what the view needs", () => {
  for (const p of ALL_PROVIDERS) {
    for (const key of ["id", "name", "command", "install"]) assert.equal(typeof p[key], "string", `${p.id}.${key}`);
  }
  assert.equal(new Set(ALL_PROVIDERS.map((p) => p.id)).size, ALL_PROVIDERS.length);
  assert.deepEqual(ALL_PROVIDERS.map((p) => p.id), ["opencode", "claude", "codex"]);
  // OpenCode and Codex are off for now: only Claude Code is offered.
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

const { conversationArgs, findCodexSessions } = createRequire(import.meta.url)("../providers.js");
const byId = (id) => ALL_PROVIDERS.find((p) => p.id === id);

test("claude and opencode open a conversation with an id the view chooses", () => {
  const claude = byId("claude");
  const id = claude.newConversation();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(conversationArgs(claude, id, false), ["--session-id", id]);
  assert.deepEqual(conversationArgs(claude, id, true), ["--resume", id]);
  const opencode = byId("opencode");
  const ses = opencode.newConversation();
  assert.match(ses, /^ses_[A-Za-z0-9]{26}$/);
  assert.notEqual(ses, opencode.newConversation());
  assert.deepEqual(conversationArgs(opencode, ses, false), ["--session", ses]);
  assert.deepEqual(conversationArgs(opencode, ses, true), ["--session", ses]);
});

test("codex can only resume, with the id found after it started", () => {
  const codex = byId("codex");
  assert.equal(codex.newConversation, undefined);
  assert.deepEqual(conversationArgs(codex, undefined, false), []);
  assert.deepEqual(conversationArgs(codex, "01a1d164-93b6-7160-9582-cbfb09605720", true), ["resume", "01a1d164-93b6-7160-9582-cbfb09605720"]);
});

test("an id that could reach the shell as code is never passed", () => {
  for (const bad of ["x; rm -rf ~", "$(id)", "a b", "`id`", ""]) {
    assert.deepEqual(conversationArgs(byId("claude"), bad, true), []);
    assert.deepEqual(conversationArgs(byId("codex"), bad, true), []);
  }
});

test("command appends the arguments to the agent's command", () => {
  assert.deepEqual(command({ command: "agent" }, "linux", ["--resume", "abc-1"]), { file: "bash", args: ["-ic", "agent --resume abc-1"] });
  assert.deepEqual(command({ command: "agent" }, "win32", ["resume", "x"]), { file: "powershell.exe", args: ["-NoLogo", "-Command", "agent resume x"] });
});

test("findCodexSessions matches each session with the first rollout started after it, in this folder", () => {
  const rollouts = [
    { id: "r-other-folder", cwd: "/elsewhere", started: 105 },
    { id: "r-early", cwd: "/work", started: 90 },
    { id: "r-a", cwd: "/work", started: 101 },
    { id: "r-b", cwd: "/work", started: 202 },
    { id: "r-c", cwd: "/work", started: 203 },
  ];
  const found = findCodexSessions(
    [
      { id: "s2", startedAt: 200 },
      { id: "s1", startedAt: 100 },
      { id: "s3", startedAt: 300 },
    ],
    rollouts,
    "/work"
  );
  assert.deepEqual(found, { s1: "r-a", s2: "r-b" });
});
