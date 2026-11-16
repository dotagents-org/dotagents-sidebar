import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sessions = require("../sessions.js");
const { AGENTS, command, conversationArgs, env, terminalCommand } = require("../agent.js");

// Load the real view with VS Code and logging replaced; keep its class private in production.
function view(kind) {
  const messages = [];
  let disposed = 0;
  const vscode = {
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
  const context = { workspaceState: { get: () => undefined, update() {} } };
  const view = new extension.exports.SidebarView(context);
  view.state = sessions.add(view.state, kind === "terminal" ? "Terminal" : "Claude Code", kind);
  view.view = { webview: { postMessage: (msg) => messages.push(msg) } };
  view.connectHost = async () => ({ send: (msg) => messages.push(msg) });
  return { view, messages, disposed: () => disposed };
}

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
