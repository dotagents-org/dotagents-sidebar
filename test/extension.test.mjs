import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sessions = require("../src/sessions/sessions.js");
const { AGENTS, command, conversationArgs, env, terminalCommand } = require("../src/sessions/agent.js");
const sessionHook = require("../src/sessions/session-hook.js");

// Load the real view with VS Code and logging replaced; keep its class private in production.
function view(kind, { picks = [], config = {}, storage, folder = true, workspace = new Map() } = {}) {
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
      // Each list answers with the item whose label the test gave, in order (undefined: Escape); a
      // function stands for what happens while the list is open, and returns the label
      showQuickPick: async (items, options) => {
        asked.push({ items, options });
        const pick = picks.shift();
        const label = typeof pick === "function" ? pick() : pick;
        return items.find((i) => i.label === label);
      },
    },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    Uri: { joinPath: (...parts) => parts.join("/") },
    env: { clipboard: { writeText: async (text) => clipboard.push(text), readText: async () => "pasted" } },
  };
  const file = path.join(import.meta.dirname, "..", "src/extension.js");
  const extension = new Module(file);
  const localRequire = createRequire(file);
  extension.require = (id) => id === "vscode" ? vscode : id === "./log.js" ? { writer: () => () => {} } : localRequire(id);
  extension._compile(`${fs.readFileSync(file, "utf8")}\nmodule.exports.SidebarView = SidebarView;\nmodule.exports.hostKey = hostKey;`, file);
  const context = {
    extensionUri: "/ext",
    workspaceState: { get: (key) => (key === "sessions" ? undefined : workspace.get(key)), update: (key, value) => workspace.set(key, value) },
    globalState: { get: (key) => global.get(key), update: (key, value) => global.set(key, value) },
    ...(storage ? { globalStorageUri: { fsPath: storage }, ...(folder ? { storageUri: { fsPath: path.join(storage, "workspace") } } : {}) } : {}),
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
  assert.ok(asked[1].items.every((i) => i.kind === undefined), "kind is VS Code's QuickPickItemKind (a separator or not)");
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

test("dropping a session on another to join it asks the side first, the last one used on top, and Escape changes nothing", async () => {
  const { view: sidebar, asked, global } = view(undefined, { picks: ["Up", undefined] });
  sidebar.state = sessions.add(sessions.add(sidebar.state, "A"), "A");
  const [first, second] = sidebar.state.sessions.map((s) => s.id);
  global.set("splitDirection", "up");
  await sidebar.onMessage({ type: "join", id: second, target: first }); // dragged onto it with Shift
  assert.deepEqual(asked[0].items.map((i) => i.label), ["Up", "Right", "Down", "Left"]);
  assert.equal(asked[0].options.title, "Join Session");
  assert.deepEqual(sidebar.state.sessions.map((s) => s.id).slice(0, 2), [second, first]); // above it
  assert.equal(sidebar.session(second).group, sidebar.session(first).group);
  assert.equal(sidebar.state.layouts[sidebar.session(first).group].axis, "column");
  const third = (sidebar.state = sessions.add(sidebar.state, "A")).active;
  const before = sidebar.state;
  await sidebar.onMessage({ type: "join", id: third, target: first }); // Escape on the list
  assert.equal(sidebar.state, before);
});

// A session that closes on its own while a list is open (its agent or shell exited cleanly) puts
// another in view, and the view focuses it: with a list of VS Code's open, that would close it
test("while a list is open, the view is told to leave the focus alone", async () => {
  let during;
  const { view: sidebar, messages } = view(undefined, { picks: [() => ((during = messages.filter((m) => m.type === "picking").at(-1)), undefined)] });
  sidebar.state = sessions.add(sidebar.state, "A");
  const [first, second] = sidebar.state.sessions.map((s) => s.id);
  await sidebar.onMessage({ type: "join", id: second, target: first });
  assert.deepEqual(during, { type: "picking", on: true });
  assert.deepEqual(messages.filter((m) => m.type === "picking").at(-1), { type: "picking", on: false });
});

test("a list opened over another keeps the view leaving the focus alone until the last one closes", async () => {
  let release;
  const { view: sidebar, messages, vscode } = view(undefined);
  const lists = [new Promise((resolve) => (release = resolve)), Promise.resolve(undefined)];
  vscode.window.showQuickPick = () => lists.shift();
  const first = sidebar.quickPick([], {});
  await sidebar.quickPick([], {}); // the second one closes while the first is still open
  assert.deepEqual(messages.filter((m) => m.type === "picking").at(-1), { type: "picking", on: true });
  release(undefined);
  await first;
  assert.deepEqual(messages.filter((m) => m.type === "picking").at(-1), { type: "picking", on: false });
});

test("a join whose target got too deep while the list was open says so and keeps the last side", async () => {
  const { DEPTH } = require("../src/shared/layout.js");
  let sidebar;
  let first;
  const tooDeepNow = () => {
    for (let i = 0; i <= DEPTH; i++) sidebar.state = sessions.split(sidebar.state, "A", undefined, undefined, i % 2 ? "down" : "right", first);
    return "Up";
  };
  const made = view(undefined, { picks: [tooDeepNow] });
  sidebar = made.view;
  sidebar.state = sessions.add(sidebar.state, "A");
  [first] = sidebar.state.sessions.map((s) => s.id);
  const second = sidebar.state.sessions[1].id;
  await sidebar.onMessage({ type: "join", id: second, target: first });
  assert.equal(made.told.length, 1);
  assert.notEqual(sidebar.session(second).group, sidebar.session(first).group);
  assert.equal(made.global.get("splitDirection"), undefined);
});

test("a pane too deep to split says so, before asking anything and without changing the last side", async () => {
  const { DEPTH } = require("../src/shared/layout.js");
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

// The view's storage in a temporary folder, removed after the test
function withStorage(run) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-storage-"));
  return Promise.resolve(run(storage)).finally(() => fs.rmSync(storage, { recursive: true, force: true }));
}

// What a session's agent would write through its hook: to the file its launch was given
const tell = (sidebar, id, conversation, source) => fs.writeFileSync(sidebar.hookFile(id), JSON.stringify({ session_id: conversation, source }));

test("an agent starts with the session hook and the file it writes to", () =>
  withStorage(async (storage) => {
    const { view: sidebar, messages } = view(undefined, { storage });
    const id = sidebar.state.active;
    sidebar.start(id);
    await Promise.resolve();
    const settings = path.join(storage, "claude-session-hook.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), sessionHook.claudeSettings(process.platform));
    const create = messages.at(-1);
    assert.deepEqual(create.args, command(process.platform, AGENTS.claude, ["--settings", settings, "--session-id", sidebar.session(id).conversation]).args);
    assert.equal(create.env[sessionHook.VARIABLE], sidebar.hookFile(id));
    assert.match(path.basename(sidebar.hookFile(id)), new RegExp(`^${id}-[0-9a-f]{8}\\.json$`));
    assert.equal(path.dirname(sidebar.hookFile(id)), path.join(storage, "workspace", `session-hook-${sessionHook.FORMAT}`));
    sidebar.dispose();
  }));

test("Claude Code resumes the conversation its hook told last, as after /clear, and a fresh start forgets it", () =>
  withStorage(async (storage) => {
    const { view: sidebar, messages } = view(undefined, { storage });
    const id = sidebar.state.active;
    sidebar.start(id);
    await Promise.resolve();
    const first = sidebar.session(id).conversation;
    tell(sidebar, id, "cleared-1", "clear");
    sidebar.restart(id);
    await Promise.resolve();
    assert.equal(sidebar.session(id).conversation, "cleared-1");
    assert.match(messages.at(-1).args.at(-1), /--resume cleared-1$/);
    assert.notEqual(first, "cleared-1");
    // The process before writes late, after the restart: its file is never read again
    const before = sidebar.hookFile(id);
    sidebar.restart(id);
    await Promise.resolve();
    fs.writeFileSync(before, JSON.stringify({ session_id: "stale-1", source: "startup" }));
    sidebar.restart(id);
    await Promise.resolve();
    assert.equal(sidebar.session(id).conversation, "cleared-1");
    sidebar.start(id, true);
    await Promise.resolve();
    assert.equal(fs.existsSync(sidebar.hookFile(id)), false);
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
      const { view: sidebar } = view(undefined, { storage });
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
      tell(sidebar, a, "conv-a", "startup");
      tell(sidebar, b, "conv-b", "startup");
      assert.equal(sidebar.findCodex(), false);
      assert.equal(sidebar.session(a).conversation, "conv-a");
      assert.equal(sidebar.session(b).conversation, "conv-b");
      sidebar.dispose();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  }));

test("a Codex session that moved on after /clear keeps its new conversation from another one still waiting in the folder", () =>
  withStorage(async (storage) => {
    const codexHome = fs.mkdtempSync(path.join(storage, "codex-"));
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const { view: sidebar } = view(undefined, { storage });
      sidebar.state = sessions.add(sessions.add(sessions.EMPTY, "Codex", undefined, "codex"), "Codex", undefined, "codex");
      const [a, b] = sidebar.state.sessions.map((s) => s.id);
      sidebar.start(a);
      sidebar.start(b);
      tell(sidebar, a, "old-a", "startup");
      assert.equal(sidebar.findCodex(), true); // a has its conversation, b waits for a first prompt
      assert.equal(sidebar.session(a).conversation, "old-a");
      // /clear in a: Codex writes a new rollout in the folder, after b started, and a's hook tells it
      const day = new Date();
      const dir = path.join(codexHome, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
      fs.mkdirSync(dir, { recursive: true });
      const meta = { type: "session_meta", payload: { id: "new-a", cwd: sidebar.session(b).cwd, timestamp: new Date(sidebar.session(b).startedAt + 1).toISOString() } };
      const rollout = path.join(dir, "rollout-new-a.jsonl");
      fs.writeFileSync(rollout, JSON.stringify(meta) + "\n");
      // The file clock may run a few ms behind Date.now(): written after b started, as Codex would
      fs.utimesSync(rollout, new Date(sidebar.session(b).startedAt + 1000), new Date(sidebar.session(b).startedAt + 1000));
      tell(sidebar, a, "new-a", "clear");
      sidebar.findCodex();
      assert.equal(sidebar.session(a).conversation, "new-a");
      assert.equal(sidebar.session(b).conversation, undefined);
      sidebar.dispose();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  }));

test("a guess that took a rollout before its own session's hook told it is dropped, and never resumed", () =>
  withStorage(async (storage) => {
    const codexHome = fs.mkdtempSync(path.join(storage, "codex-"));
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const { view: sidebar, messages } = view(undefined, { storage });
      sidebar.state = sessions.add(sessions.add(sessions.EMPTY, "Codex", undefined, "codex"), "Codex", undefined, "codex");
      const [a, b] = sidebar.state.sessions.map((s) => s.id);
      sidebar.start(a);
      sidebar.start(b);
      tell(sidebar, a, "old-a", "startup");
      sidebar.findCodex();
      // /clear in a: the rollout comes first, the guess gives it to b, then a's hook tells it
      const day = new Date();
      const dir = path.join(codexHome, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
      fs.mkdirSync(dir, { recursive: true });
      const meta = { type: "session_meta", payload: { id: "new-a", cwd: sidebar.session(b).cwd, timestamp: new Date(sidebar.session(b).startedAt + 1).toISOString() } };
      const rollout = path.join(dir, "rollout-new-a.jsonl");
      fs.writeFileSync(rollout, JSON.stringify(meta) + "\n");
      // The file clock may run a few ms behind Date.now(): written after b started, as Codex would
      fs.utimesSync(rollout, new Date(sidebar.session(b).startedAt + 1000), new Date(sidebar.session(b).startedAt + 1000));
      sidebar.findCodex();
      assert.equal(sidebar.session(b).conversation, "new-a"); // the guess, wrong for now
      tell(sidebar, a, "new-a", "clear");
      sidebar.restart(b);
      await Promise.resolve();
      assert.doesNotMatch(messages.at(-1).args.join(" "), /new-a/, "b doesn't resume a's conversation");
      assert.equal(sidebar.session(b).conversation, undefined);
      sidebar.findCodex();
      assert.equal(sidebar.session(a).conversation, "new-a");
      assert.equal(sidebar.session(b).conversation, undefined);
      sidebar.dispose();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  }));

test("a Codex conversation only guessed is never resumed on its own: Codex's list asks, and a subagent's rollout is never guessed", () =>
  withStorage(async (storage) => {
    const codexHome = fs.mkdtempSync(path.join(storage, "codex-"));
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const { view: sidebar, messages } = view(undefined, { storage });
      sidebar.state = sessions.add(sessions.EMPTY, "Codex", undefined, "codex");
      const [a] = sidebar.state.sessions.map((s) => s.id);
      sidebar.start(a);
      const day = new Date();
      const dir = path.join(codexHome, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
      fs.mkdirSync(dir, { recursive: true });
      const at = sidebar.session(a).startedAt;
      const rollout = (id, extra) => {
        const file = path.join(dir, `rollout-${id}.jsonl`);
        fs.writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { id, cwd: sidebar.session(a).cwd, timestamp: new Date(at + 1).toISOString(), ...extra } }) + "\n");
        fs.utimesSync(file, new Date(at + 1000), new Date(at + 1000));
      };
      rollout("helper-1", { source: { subagent: { thread_spawn: {} } }, parent_thread_id: "x" });
      sidebar.findCodex();
      assert.equal(sidebar.session(a).conversation, undefined, "a subagent's rollout isn't a session's");
      rollout("guess-1", {});
      sidebar.findCodex();
      assert.deepEqual([sidebar.session(a).conversation, sidebar.session(a).guessed], ["guess-1", true]);
      sidebar.restart(a);
      await Promise.resolve();
      assert.match(messages.at(-1).args.join(" "), /codex.* resume$/, "Codex's own list, not the guessed id");
      assert.doesNotMatch(messages.at(-1).args.join(" "), /guess-1/);
      sidebar.dispose();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  }));

test("a Codex conversation saved before the hook counts as a guess: Codex's list asks, once its hook confirms it no longer", () =>
  withStorage(async (storage) => {
    const { view: sidebar, messages } = view(undefined, { storage });
    // As main saved it: a conversation, no guessed at all
    sidebar.state = { ...sessions.add(sessions.EMPTY, "Codex", undefined, "codex") };
    const [a] = sidebar.state.sessions.map((s) => s.id);
    sidebar.state = sessions.remember(sidebar.state, a, { conversation: "019a0000-0000-7000-8000-000000000001", cwd: "/work", startedAt: 1 });
    sidebar.start(a);
    await Promise.resolve();
    assert.match(messages.at(-1).args.join(" "), / resume$/);
    // Its hook then tells one, the same a guess had found: confirmed
    sidebar.state = sessions.remember(sidebar.state, a, { conversation: "019a0000-0000-7000-8000-000000000002", guessed: true });
    tell(sidebar, a, "019a0000-0000-7000-8000-000000000002", "resume");
    sidebar.restart(a);
    await Promise.resolve();
    assert.match(messages.at(-1).args.join(" "), /resume 019a0000-0000-7000-8000-000000000002$/);
    sidebar.dispose();
  }));

test("an empty window's host is found again after a reload by the id the window keeps, and is another window's own", () => {
  const workspace = new Map();
  const key = (made) => {
    made.vscode.workspace.workspaceFolders = undefined; // no folder
    return made.extension.exports.hostKey(made.view.windowId());
  };
  const first = key(view(undefined, { workspace }));
  assert.equal(key(view(undefined, { workspace })), first);
  assert.notEqual(key(view(undefined)), first);
});

test("the watch for Codex conversations goes on while one is only a guess, so a late hook can take it back", () =>
  withStorage(async (storage) => {
    const codexHome = fs.mkdtempSync(path.join(storage, "codex-"));
    const before = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const { view: sidebar } = view(undefined, { storage });
      sidebar.state = sessions.add(sessions.add(sessions.EMPTY, "Codex", undefined, "codex"), "Codex", undefined, "codex");
      const [a, b] = sidebar.state.sessions.map((s) => s.id);
      sidebar.start(a);
      sidebar.start(b);
      tell(sidebar, a, "old-a", "startup");
      const day = new Date();
      const dir = path.join(codexHome, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
      fs.mkdirSync(dir, { recursive: true });
      const rollout = path.join(dir, "rollout-new-a.jsonl");
      fs.writeFileSync(rollout, JSON.stringify({ type: "session_meta", payload: { id: "new-a", cwd: sidebar.session(b).cwd, timestamp: new Date(sidebar.session(b).startedAt + 1).toISOString() } }) + "\n");
      fs.utimesSync(rollout, new Date(sidebar.session(b).startedAt + 1000), new Date(sidebar.session(b).startedAt + 1000));
      assert.equal(sidebar.findCodex(), true, "b has a guess, a's hook may still say it's a's");
      assert.equal(sidebar.session(b).conversation, "new-a");
      tell(sidebar, a, "new-a", "clear"); // the hook comes late
      assert.equal(sidebar.findCodex(), true, "b is left waiting for its own");
      assert.equal(sidebar.session(b).conversation, undefined);
      assert.equal(sidebar.session(a).conversation, "new-a");
      sidebar.dispose();
    } finally {
      if (before === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = before;
    }
  }));

test("a window with no folder keeps its agents' hook files apart from another such window's, across a reload", () =>
  withStorage(async (storage) => {
    const fileOf = async (made) => {
      const id = made.view.state.active;
      made.view.start(id);
      await Promise.resolve();
      const file = made.messages.at(-1).env[sessionHook.VARIABLE];
      made.view.dispose();
      return path.dirname(file); // the window's folder; each launch has its own file in it
    };
    const workspace = new Map();
    const first = await fileOf(view(undefined, { storage, folder: false, workspace }));
    assert.ok(first.startsWith(path.join(storage, "windows")));
    assert.equal(await fileOf(view(undefined, { storage, folder: false, workspace })), first, "the same window after a reload");
    assert.notEqual(await fileOf(view(undefined, { storage, folder: false })), first, "another window");
  }));
