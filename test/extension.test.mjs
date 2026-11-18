import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sessions = require("../sessions.js");
const { AGENTS, command, conversationArgs, env, terminalCommand } = require("../agent.js");

// Load the real view with VS Code and logging replaced; keep its class private in production.
function view(kind, { picks = [], config = {} } = {}) {
  const messages = [];
  let disposed = 0;
  const ran = [];
  const asked = []; // the quick picks shown: their items and options
  const clipboard = [];
  const told = []; // the information messages shown
  const warned = [];
  const global = new Map();
  const vscode = {
    commands: { executeCommand: (...args) => ran.push(args) },
    workspace: {
      workspaceFolders: [{ uri: { scheme: "file", fsPath: "/work/project" } }],
      getConfiguration: (section) => ({ get: (key) => (key === "scrollback" ? 4321 : config[`${section}.${key}`]) }),
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() { disposed++; } }),
      showInformationMessage: (text) => told.push(text),
      showWarningMessage: (text) => warned.push(text),
      // Each list answers with the item whose label the test gave, in order (undefined: Escape)
      showQuickPick: async (items, options) => {
        asked.push({ items, options });
        const label = picks.shift();
        return items.find((i) => i.label === label);
      },
    },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    Uri: { joinPath: (...parts) => parts.join("/") },
    env: { clipboard: { writeText: async (text) => clipboard.push(text), readText: async () => "pasted" } },
  };
  const file = path.join(import.meta.dirname, "..", "extension.js");
  const extension = new Module(file);
  const localRequire = createRequire(file);
  extension.require = (id) => id === "vscode" ? vscode : id === "./log.js" ? { writer: () => () => {} } : localRequire(id);
  extension._compile(`${fs.readFileSync(file, "utf8")}\nmodule.exports.SidebarView = SidebarView;`, file);
  const context = {
    extensionUri: "/ext",
    workspaceState: { get: () => undefined, update() {} },
    globalState: { get: (key) => global.get(key), update: (key, value) => global.set(key, value) },
  };
  const view = new extension.exports.SidebarView(context);
  view.state = sessions.add(view.state, kind === "terminal" ? "Terminal" : "Claude Code", kind);
  view.view = { webview: { postMessage: (msg) => messages.push(msg) } };
  view.connectHost = async () => ({ send: (msg) => messages.push(msg) });
  return { view, messages, ran, asked, clipboard, told, warned, global, vscode, extension, disposed: () => disposed };
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

test("Split Session... asks the side, then the kind, the last side and the session's kind first", async () => {
  const { view: sidebar, asked, global } = view("terminal", { picks: ["Down", "Codex"] });
  await sidebar.split();
  assert.deepEqual(asked[0].items.map((i) => i.label), ["Right", "Down", "Left", "Up"]); // nothing used yet
  assert.deepEqual(asked[1].items.map((i) => i.label), ["Terminal", "Claude Code", "Codex"]); // the terminal's kind first
  assert.deepEqual(sidebar.state.sessions.map((s) => [s.id, s.provider]), [["s1", undefined], ["s2", "codex"]]);
  assert.equal(sidebar.state.layouts.s1.axis, "column");
  assert.equal(global.get("splitDirection"), "down");
  // The next time, the side used last comes first
  const again = view(undefined, { picks: ["Down", "Claude Code"] });
  again.global.set("splitDirection", "left");
  await again.view.split();
  assert.deepEqual(again.asked[0].items.map((i) => i.label), ["Left", "Right", "Down", "Up"]); // the last one first, the rest in order
  assert.deepEqual(again.asked[1].items.map((i) => i.label), ["Claude Code", "Codex", "Terminal"]);
});

test("Split Session... splits the session it was asked for, and Escape changes nothing", async () => {
  const { view: sidebar } = view(undefined, { picks: ["Left", "Terminal"] });
  sidebar.state = sessions.add(sidebar.state, "Claude Code"); // s2, active
  await sidebar.split("s1");
  assert.deepEqual(sidebar.state.sessions.map((s) => s.id), ["s3", "s1", "s2"]);
  assert.equal(sidebar.state.sessions[0].kind, "terminal");
  assert.equal(sidebar.state.active, "s3");
  const before = sidebar.state;
  await sidebar.split(); // no picks left: Escape on the first list
  assert.equal(sidebar.state, before);
  const { view: other, global } = view(undefined, { picks: ["Right"] }); // Escape on the second
  const state = other.state;
  await other.split();
  assert.equal(other.state, state);
  assert.equal(global.get("splitDirection"), undefined);
});

test("a dragged border is checked before it changes the split", async () => {
  const { view: sidebar, messages } = view(undefined, { picks: ["Right", "Claude Code"] });
  await sidebar.split();
  const tree = () => sidebar.state.layouts.s1;
  const shape = "row(s1,s2)";
  sidebar.onMessage({ type: "resizeSplit", group: "s1", shape, path: [], ratio: 0.3, request: 7 });
  assert.equal(tree().ratio, 0.3);
  assert.deepEqual(messages.slice(-2).map((m) => m.type), ["state", "resized"]); // the state first, then the answer
  assert.equal(messages.at(-1).request, 7);
  sidebar.onMessage({ type: "resizeSplit", group: "s1", shape: "row(s2,s1)", path: [], ratio: 0.6, request: 8 });
  assert.deepEqual(messages.at(-1), { type: "resized", request: 8 }); // turned down, but answered
  for (const bad of [
    { group: "s1", shape, path: [], ratio: "0.6" },
    { group: "s1", shape, path: "a", ratio: 0.6 },
    { group: "s1", shape, path: ["c"], ratio: 0.6 },
    { group: "s1", shape, path: Array(17).fill("a"), ratio: 0.6 },
    { group: 1, shape, path: [], ratio: 0.6 },
    { group: "s1", path: [], ratio: 0.6 },
    { group: "s1", shape: "row(s2,s1)", path: [], ratio: 0.6 },
    { group: "constructor", shape: "s1", path: [], ratio: 0.6 },
  ]) sidebar.onMessage({ type: "resizeSplit", ...bad });
  assert.equal(Object.hasOwn(sidebar.state.layouts, "constructor"), false);
  assert.equal(tree().ratio, 0.3);
});

test("a right click follows dotagentsSidebar.rightClickBehavior, else the integrated terminal", () => {
  const page = (config) => {
    const { view: sidebar } = view(undefined, { config });
    const html = sidebar.html({ asWebviewUri: (u) => u, cspSource: "csp" });
    return JSON.parse(html.match(/DOTAGENTS_SIDEBAR_SETTINGS = (\{.*\});/)[1]).rightClickBehavior;
  };
  assert.equal(page({}), "copyPaste");
  assert.equal(page({ "terminal.integrated.rightClickBehavior": "paste" }), "paste");
  assert.equal(page({ "terminal.integrated.rightClickBehavior": "selectWord" }), "menu");
  assert.equal(page({ "terminal.integrated.rightClickBehavior": "paste", "dotagentsSidebar.rightClickBehavior": "menu" }), "menu");
  assert.equal(page({ "dotagentsSidebar.rightClickBehavior": "copyPaste", "terminal.integrated.rightClickBehavior": "default" }), "copyPaste");
});

test("Copy and Paste in a pane's menu go through VS Code's clipboard", async () => {
  const { view: sidebar, messages, clipboard, warned } = view();
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  sidebar.onMessage({ type: "copied", text: "unasked" }); // no Copy asked for
  sidebar.copy("s1");
  const { request } = messages.at(-1);
  assert.deepEqual(messages.at(-1), { type: "copy", id: "s1", request });
  sidebar.onMessage({ type: "copied", request: "other", text: "stale" });
  sidebar.onMessage({ type: "copied", request, text: "selected" });
  sidebar.onMessage({ type: "copied", request, text: "again" }); // one answer per Copy
  await settle();
  assert.deepEqual(clipboard, ["selected"]);
  assert.deepEqual(messages.at(-1), { type: "copiedDone", id: "s1", request }); // the page clears the selection
  // Copy twice before the first answer: the first answer is ignored, the second taken
  sidebar.copy("s1");
  const first = messages.at(-1).request;
  sidebar.copy("s1");
  const second = messages.at(-1).request;
  sidebar.onMessage({ type: "copied", request: first, text: "old" });
  sidebar.onMessage({ type: "copied", request: second, text: "new" });
  await settle();
  assert.deepEqual(clipboard, ["selected", "new"]);
  // Too long: nothing copied, and the view says so
  sidebar.copy("s1");
  sidebar.onMessage({ type: "copied", request: messages.at(-1).request, text: "x".repeat((1 << 20) + 1) });
  await settle();
  assert.deepEqual(clipboard, ["selected", "new"]);
  assert.equal(warned.length, 1);
  await sidebar.paste("s1");
  assert.deepEqual(messages.at(-1), { type: "paste", id: "s1", text: "pasted" });
});

test("a Copy the clipboard refuses says so and leaves the selection", async () => {
  const { view: sidebar, messages, warned, vscode } = view();
  vscode.env.clipboard.writeText = async () => { throw new Error("denied"); };
  sidebar.copy("s1");
  sidebar.onMessage({ type: "copied", request: messages.at(-1).request, text: "selected" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warned.length, 1);
  assert.notEqual(messages.at(-1).type, "copiedDone");
});

test("a pane too deep to split says so, before asking anything and without changing the last side", async () => {
  const { DEPTH } = require("../media/layout.js");
  const { view: sidebar, asked, told, global } = view(undefined, { picks: ["Right", "Claude Code"] });
  for (let i = 0; i <= DEPTH; i++) sidebar.state = sessions.split(sidebar.state, "A", undefined, undefined, i % 2 ? "down" : "right");
  const state = sidebar.state;
  await sidebar.split();
  assert.equal(sidebar.state, state);
  assert.equal(asked.length, 0);
  assert.equal(told.length, 1);
  assert.equal(global.get("splitDirection"), undefined);
  sidebar.state = sessions.add(sidebar.state, "A");
  const other = sidebar.state.active;
  sidebar.onMessage({ type: "join", id: other, target: state.active }); // dragged onto it with Shift
  assert.equal(told.length, 2);
  assert.equal(sidebar.session(other).group, other);
});
