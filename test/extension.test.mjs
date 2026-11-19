import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sessions = require("../sessions.js");
const { AGENTS, command, conversationArgs, env, terminalCommand } = require("../agent.js");
const sessionHook = require("../session-hook.js");

// Load the real view with VS Code and logging replaced; keep its class private in production.
function view(kind, storage, { folder = true } = {}) {
  const messages = [];
  let disposed = 0;
  const ran = [];
  const vscode = {
    commands: { executeCommand: (...args) => ran.push(args) },
    workspace: {
      workspaceFolders: [{ uri: { scheme: "file", fsPath: "/work/project" } }],
      getConfiguration: () => ({ get: (key) => key === "scrollback" ? 4321 : undefined }),
    },
    window: { createOutputChannel: () => ({ appendLine() {}, dispose() { disposed++; } }) },
  };
  const file = path.join(import.meta.dirname, "..", "extension.js");
  const extension = new Module(file);
  const localRequire = createRequire(file);
  extension.require = (id) => id === "vscode" ? vscode : id === "./log.js" ? { writer: () => () => {} } : localRequire(id);
  extension._compile(`${fs.readFileSync(file, "utf8")}\nmodule.exports.SidebarView = SidebarView;`, file);
  const context = { workspaceState: { get: () => undefined, update() {} }, ...(storage ? { globalStorageUri: { fsPath: storage }, ...(folder ? { storageUri: { fsPath: path.join(storage, "workspace") } } : {}) } : {}) };
  const view = new extension.exports.SidebarView(context);
  view.state = sessions.add(view.state, kind === "terminal" ? "Terminal" : "Claude Code", kind);
  view.view = { webview: { postMessage: (msg) => messages.push(msg) } };
  view.connectHost = async () => ({ send: (msg) => messages.push(msg) });
  return { view, messages, ran, disposed: () => disposed };
}

test("the title strip's buttons run only the commands it draws", () => {
  const { view: sidebar, ran } = view();
  sidebar.onMessage({ type: "command", command: "dotagentsSidebar.new.codex" });
  sidebar.onMessage({ type: "command", command: "dotagentsSidebar.split" });
  sidebar.onMessage({ type: "command", command: "dotagentsSidebar.restart" });
  sidebar.onMessage({ type: "command", command: "workbench.action.terminal.sendSequence" });
  sidebar.onMessage({ type: "command", command: "toString" });
  assert.deepEqual(ran, [["dotagentsSidebar.new.codex"], ["dotagentsSidebar.split"], ["dotagentsSidebar.restart"]]);
});

for (const kind of [undefined, "terminal"]) {
  test(`starting ${kind || "an agent"} clears its pane and sends the full host create message`, async () => {
    const { view: sidebar, messages } = view(kind);
    const id = sidebar.state.active;
    sidebar.terminal(id).size = { cols: 123, rows: 45 };
    sidebar.start(id);
    await Promise.resolve();
    const conversation = sidebar.session(id).conversation;
    const launch = kind === "terminal" ? terminalCommand(process.platform, process.env) : command(process.platform, AGENTS.claude, conversationArgs(AGENTS.claude, conversation, false));
    assert.deepEqual(messages.slice(-2), [
      { type: "clear", id },
      { type: "create", id, ...launch, cwd: "/work/project", env: env(process.env), cols: 123, rows: 45, scrollback: 4321 },
    ]);
    assert.equal(sidebar.terminal(id).started, true);
    assert.equal(sidebar.terminal(id).exited, false);
    sidebar.dispose();
  });
}

test("dispose closes the host channel and the output channel", async () => {
  const { view: sidebar, disposed } = view();
  let closed = 0;
  sidebar.hostReady = Promise.resolve({ close() { closed++; } });
  sidebar.dispose();
  await sidebar.hostReady;
  assert.equal(closed, 1);
  assert.equal(disposed(), 1);
});

test("an agent exit keeps the dim notice in the host's screen", async () => {
  const { view: sidebar, messages } = view();
  const id = sidebar.state.active;
  sidebar.terminal(id);
  sidebar.exited(id, 3);
  await Promise.resolve();
  assert.deepEqual(messages.at(-1), { type: "note", id, data: "\r\n\x1b[2m[Claude Code exited with code 3. Press Enter to start it again.]\x1b[0m\r\n" });
  sidebar.dispose();
});

// The view's storage in a temporary folder, removed after the test
function withStorage(run) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-storage-"));
  return Promise.resolve(run(storage)).finally(() => fs.rmSync(storage, { recursive: true, force: true }));
}

const hookFile = (storage, id) => path.join(storage, "workspace", "sessions", `${id}.json`);
const tell = (storage, id, conversation, source) => fs.writeFileSync(hookFile(storage, id), JSON.stringify({ session_id: conversation, source }));

test("an agent starts with the session hook and the file it writes to", () =>
  withStorage(async (storage) => {
    const { view: sidebar, messages } = view(undefined, storage);
    const id = sidebar.state.active;
    sidebar.start(id);
    await Promise.resolve();
    const settings = path.join(storage, "claude-session-hook.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), sessionHook.claudeSettings(process.platform));
    const create = messages.at(-1);
    assert.deepEqual(create.args, command(process.platform, AGENTS.claude, ["--settings", settings, "--session-id", sidebar.session(id).conversation]).args);
    assert.equal(create.env[sessionHook.VARIABLE], hookFile(storage, id));
    sidebar.dispose();
  }));

test("Claude Code resumes the conversation its hook told last, as after /clear, and a fresh start forgets it", () =>
  withStorage(async (storage) => {
    const { view: sidebar, messages } = view(undefined, storage);
    const id = sidebar.state.active;
    sidebar.start(id);
    await Promise.resolve();
    const first = sidebar.session(id).conversation;
    tell(storage, id, "cleared-1", "clear");
    sidebar.restart(id);
    await Promise.resolve();
    assert.equal(sidebar.session(id).conversation, "cleared-1");
    assert.match(messages.at(-1).args.at(-1), /--resume cleared-1$/);
    assert.notEqual(first, "cleared-1");
    sidebar.start(id, true);
    await Promise.resolve();
    assert.equal(fs.existsSync(hookFile(storage, id)), false);
    assert.notEqual(sidebar.session(id).conversation, "cleared-1");
    sidebar.close(id);
    sidebar.dispose();
  }));

test("two Codex sessions started together in one folder take the conversations their hooks told, not the rollouts' order", () =>
  withStorage(async (storage) => {
    const codexHome = fs.mkdtempSync(path.join(storage, "codex-"));
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const { view: sidebar } = view(undefined, storage);
      sidebar.state = sessions.add(sessions.add(sessions.EMPTY, "Codex", undefined, "codex"), "Codex", undefined, "codex");
      const [a, b] = sidebar.state.sessions.map((s) => s.id);
      sidebar.start(a);
      sidebar.start(b);
      // Both rollouts are in the same folder, the later session's first: a guess by time would swap them
      const day = new Date();
      const dir = path.join(codexHome, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
      fs.mkdirSync(dir, { recursive: true });
      const startedAt = sidebar.session(a).startedAt;
      for (const [conversation, at] of [["conv-b", startedAt + 1], ["conv-a", startedAt + 2]]) {
        const meta = { type: "session_meta", payload: { id: conversation, cwd: "/work/project", timestamp: new Date(at).toISOString() } };
        fs.writeFileSync(path.join(dir, `rollout-${conversation}.jsonl`), JSON.stringify(meta) + "\n");
      }
      tell(storage, a, "conv-a", "startup");
      tell(storage, b, "conv-b", "startup");
      assert.equal(sidebar.findCodex(), false);
      assert.equal(sidebar.session(a).conversation, "conv-a");
      assert.equal(sidebar.session(b).conversation, "conv-b");
      sidebar.dispose();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  }));

test("a window with no folder gives its agents no hook: its session ids would meet another window's", () =>
  withStorage(async (storage) => {
    const { view: sidebar, messages } = view(undefined, storage, { folder: false });
    const id = sidebar.state.active;
    sidebar.start(id);
    await Promise.resolve();
    assert.deepEqual(messages.at(-1).args, command(process.platform, AGENTS.claude, ["--session-id", sidebar.session(id).conversation]).args);
    assert.equal(messages.at(-1).env[sessionHook.VARIABLE], undefined);
    sidebar.dispose();
  }));
