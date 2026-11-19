const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { writer } = require("./log.js");
const { spawn } = require("child_process");
const host = require("./host/host.js");
const { AGENTS, agentOf, TERMINAL, terminalCommand, newConversation, command, conversationArgs, env } = require("./sessions/agent.js");
const sessions = require("./sessions/sessions.js");
const layout = require("./shared/layout.js");
const codexSessions = require("./sessions/codex-sessions.js");
const keys = require("./shared/keys.js");

const { startAccounts } = require("./accounts/accounts.js");
const SKIP_SHELL = require("./skip-shell.json");
const { contributes } = require("../package.json");

// The buttons at the right of the title strip, in order, with the icon each command declares
// (webview/terminals/view.js draws them; the strip replaces VS Code's title bar buttons)
const TITLE_BUTTONS = ["dotagentsSidebar.new", "dotagentsSidebar.new.codex", "dotagentsSidebar.newTerminal"];
// The round buttons at its left, for the active session: red closes it (a message of its own), amber
// splits it, green restarts it
const SESSION_BUTTONS = ["dotagentsSidebar.split", "dotagentsSidebar.restart"];

// One host per workspace and protocol (src/host/host.js), not per version of the extension: an update
// reaches the host the old version started, and its agents keep running. An empty window has
// nothing to come back to, so its host is its own
function hostKey() {
  const workspace = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0]?.uri;
  const id = workspace ? workspace.toString() : `window-${vscode.env.sessionId}`;
  const hash = crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
  return `p${host.PROTOCOL}-${hash}`;
}

// The workspace's name without what VS Code adds in a remote window (" [WSL: Ubuntu]")
function workspaceName() {
  return (vscode.workspace.name || "").replace(/\s*\[[^\]]*\]$/, "");
}

// File links: which of the paths a session printed exist, and opening one. A path is tried as it
// is when absolute (~ is home), else from the folder the sessions run in and from each workspace
// folder, as the integrated terminal does from its cwd. What a lookup found, or didn't, is kept
// for 10 seconds, so hovering over the same line asks the disk once.
const FILE_CACHE_MS = 10_000;
const fileCache = new Map();
async function existingPath(text) {
  let p = text.replace(/^file:\/\//i, "");
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
  const bases = [cwd(), ...(vscode.workspace.workspaceFolders || []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath)];
  const tries = path.isAbsolute(p) ? [p] : [...new Set(bases.map((base) => path.resolve(base, p)))];
  for (const file of tries) {
    const hit = fileCache.get(file);
    if (hit && Date.now() - hit.at < FILE_CACHE_MS) {
      if (hit.kind) return { file, kind: hit.kind };
      continue;
    }
    const stat = await fs.promises.stat(file).catch(() => null);
    const kind = stat?.isFile() ? "file" : stat?.isDirectory() ? "folder" : null;
    fileCache.set(file, { kind, at: Date.now() });
    if (kind) return { file, kind };
  }
  return null;
}

// Opens a file at its line and column, or shows a folder in the Explorer; only what exists
async function openPath(text, line, column) {
  const found = await existingPath(text);
  if (!found) return;
  const uri = vscode.Uri.file(found.file);
  if (found.kind === "folder") return vscode.commands.executeCommand("revealInExplorer", uri);
  const position = new vscode.Position(Math.max(0, (line || 1) - 1), Math.max(0, (column || 1) - 1));
  await vscode.commands.executeCommand("vscode.open", uri, { selection: new vscode.Range(position, position), preview: false });
}

function cwd() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && folder.uri.scheme === "file" ? folder.uri.fsPath : os.homedir();
}

// The view mirrors the integrated terminal's font settings, so text looks the way the user
// already tuned it for their screen
const WATCHED = [
  "dotagentsSidebar",
  "terminal.integrated.commandsToSkipShell",
  "terminal.integrated.sendKeybindingsToShell",
  "terminal.integrated.allowChords",
  "editor.fontFamily",
  "editor.fontSize",
  ...["fontFamily", "fontSize", "lineHeight", "letterSpacing", "fontWeight", "fontWeightBold", "minimumContrastRatio", "scrollback", "rightClickBehavior"].map(
    (key) => `terminal.integrated.${key}`
  ),
];

function terminalSettings() {
  const term = vscode.workspace.getConfiguration("terminal.integrated");
  const editor = vscode.workspace.getConfiguration("editor");
  return {
    fontFamily: term.get("fontFamily") || editor.get("fontFamily") || "monospace",
    fontSize: term.get("fontSize") || editor.get("fontSize") || 14,
    lineHeight: term.get("lineHeight") || 1,
    letterSpacing: term.get("letterSpacing") || 0,
    fontWeight: term.get("fontWeight") || "normal",
    fontWeightBold: term.get("fontWeightBold") || "bold",
    minimumContrastRatio: term.get("minimumContrastRatio") ?? 4.5,
    // For the agents that write their conversation to the normal screen
    scrollback: term.get("scrollback") ?? 1000,
    rightClickBehavior: rightClick(term.get("rightClickBehavior")),
    // Not the terminal's gpuAcceleration: block and box characters only draw seamlessly
    // with the WebGL renderer (DOM leaves hairlines)
    renderer: vscode.workspace.getConfiguration("dotagentsSidebar").get("renderer") || "webgl",
  };
}

// What a right click on a pane does (dotagentsSidebar.rightClickBehavior): copyPaste copies the
// selection or pastes, paste always pastes, menu opens the pane's menu. "terminal" (the default)
// does what the integrated terminal does (copyPaste is Windows' default); its other behaviors
// (default, selectWord, nothing) leave the click to VS Code, which opens the menu
function rightClick(terminal) {
  const own = vscode.workspace.getConfiguration("dotagentsSidebar").get("rightClickBehavior") || "terminal";
  const behavior = own === "terminal" ? terminal || "copyPaste" : own;
  return behavior === "copyPaste" || behavior === "paste" ? behavior : "menu";
}

// The sides a split can open on, in the order Split Session... lists them after the last one used
const DIRECTIONS = [
  { dir: "right", label: "Right", description: "beside it, on the right", icon: "split-horizontal" },
  { dir: "down", label: "Down", description: "below it", icon: "split-vertical" },
  { dir: "left", label: "Left", description: "beside it, on the left", icon: "split-horizontal" },
  { dir: "up", label: "Up", description: "above it", icon: "split-vertical" },
];

// The most text the page may hand over for the clipboard (a selection copied from a pane)
const MAX_COPY = 1 << 20;

const notice = (text) => `\r\n\x1b[2m[${text}]\x1b[0m\r\n`;

class SidebarView {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.state = sessions.restore(context.workspaceState.get("sessions"));
    // Session id -> what the extension knows of its agent; the process and the screen live in the host
    this.terminals = new Map();
    this.snapshots = []; // the replies the host still owes, in order
    this.hostReady = undefined;
    this.disposed = false;
    this.keys = undefined; // the keys VS Code keeps, once worked out
    // The output channel, and sidebar.log for when the window is gone (src/log.js)
    const channel = vscode.window.createOutputChannel("dotagents-sidebar");
    const file = writer("sidebar");
    this.log = {
      info: (text) => {
        channel.appendLine(`${new Date().toISOString()} ${text}`);
        file("info", "extension", text);
      },
      error: (text, err) => {
        channel.appendLine(`${new Date().toISOString()} ${text}: ${err.message}`);
        file("error", "extension", `${text}: ${err.stack || err.message}`);
      },
      dispose: () => channel.dispose(),
    };
    this.accounts = undefined; // the accounts (src/accounts/accounts.js), when dotagents is set up here
  }

  // With dotagents set up on this side, the accounts are a fixed tab, the first in the list:
  // src/accounts/accounts.js talks to the server, this view draws the panel and passes the messages both ways.
  connectAccounts() {
    const api = startAccounts(vscode, this.context);
    this.accounts = api ? { api, subscription: api.onDidChange((message) => this.post(message)) } : undefined;
    if (this.accounts) this.context.subscriptions.push(this.accounts.subscription);
  }

  async onAccounts(m) {
    const api = this.accounts?.api;
    if (!api) return;
    if (m.type === "ready") this.post(api.message());
    else if (m.type === "action") this.post({ type: "result", id: m.id, result: await api.act(m.action, m.body) });
  }

  // The keys that go to VS Code while a session has focus (src/shared/keys.js): the terminal's rule,
  // from VS Code's default bindings and the user's when they can be read
  async workOutKeys() {
    const read = async (uri) => {
      try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      } catch {
        try {
          return (await vscode.workspace.openTextDocument(uri)).getText();
        } catch {
          return undefined;
        }
      }
    };
    const defaults = keys.parseJsonc((await read(vscode.Uri.parse("vscode://defaultsettings/keybindings.json"))) || "");
    // globalStorageUri is <user data>/User/globalStorage/<extension>; in a remote window it is on
    // the remote side, where the user's keybindings.json isn't
    const userFile = vscode.Uri.joinPath(this.context.globalStorageUri, "..", "..", "keybindings.json");
    const user = keys.parseJsonc((await read(userFile)) || "") || [];
    const terminal = vscode.workspace.getConfiguration("terminal.integrated");
    this.keys = keys.keysForVsCode({
      bindings: Array.isArray(defaults) ? [...defaults, ...(Array.isArray(user) ? user : [])] : undefined,
      skip: keys.skipCommands(SKIP_SHELL.commands, terminal.get("commandsToSkipShell") || []),
      allowChords: terminal.get("allowChords") ?? true,
      sendKeybindingsToShell: terminal.get("sendKeybindingsToShell") ?? false,
      extra: vscode.workspace.getConfiguration("dotagentsSidebar").get("keysForVsCode") || [],
    });
    const source = Array.isArray(defaults)
      ? `VS Code's default keybindings (${defaults.length})${user.length ? ` and ${user.length} of yours` : ", without yours (not reachable from here)"}`
      : "the built-in list (VS Code's default keybindings could not be read)";
    this.log.info(`${this.keys.length} keys go to VS Code, from ${source}: ${this.keys.join(" ")}`);
    this.post({ type: "keys", keys: this.keys });
  }

  resolveWebviewView(view) {
    this.view = view;
    this.reload();
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  // Build the page, or rebuild it with the new settings; the running agents are kept and replayed
  reload() {
    if (!this.view) return;
    const roots = [["media"], ["webview"], ["src", "shared"], ["node_modules"]].map((p) => vscode.Uri.joinPath(this.context.extensionUri, ...p));
    this.view.webview.options = { enableScripts: true, localResourceRoots: roots };
    this.view.webview.html = this.html(this.view.webview);
  }

  update(state) {
    this.state = state;
    this.context.workspaceState.update("sessions", state);
    this.post({ type: "state", state });
  }

  session(id) {
    return this.state.sessions.find((s) => s.id === id);
  }

  terminal(id) {
    let terminal = this.terminals.get(id);
    if (!terminal) {
      terminal = { started: false, exited: false, resume: false, startedAt: 0, size: { cols: 80, rows: 24 } };
      this.terminals.set(id, terminal);
    }
    return terminal;
  }

  // The connection to this window's host, which is started when it isn't running
  connectHost() {
    if (!this.hostReady) {
      this.hostReady = this.reachHost().catch((err) => {
        this.hostReady = undefined;
        throw err;
      });
    }
    return this.hostReady;
  }

  async reachHost() {
    const socket = host.socketPath(hostKey());
    const connect = () =>
      host.connect(
        socket,
        (msg) => this.onHost(msg),
        () => this.onHostLost()
      );
    try {
      return await connect();
    } catch {
      // not running yet
    }
    // A host started before the socket was named by protocol (an earlier version) was named by version
    const legacy = host.socketPath(hostKey().replace(/^p\d+/, this.context.extension.packageJSON.version));
    try {
      return await host.connect(
        legacy,
        (msg) => this.onHost(msg),
        () => this.onHostLost()
      );
    } catch {
      // none either
    }
    // Detached, so it outlives the extension; ELECTRON_RUN_AS_NODE makes VS Code's own
    // executable run it as plain Node on the desktop
    const child = spawn(process.execPath, [path.join(__dirname, "host", "host.js"), socket, vscode.env.appRoot], {
      detached: true,
      stdio: "ignore",
      cwd: os.homedir(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref();
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        return await connect();
      } catch {
        // still starting
      }
    }
    throw new Error("The agents' host did not start.");
  }

  async send(msg) {
    try {
      (await this.connectHost()).send(msg);
    } catch (err) {
      if (msg.id) this.post({ type: "output", id: msg.id, data: notice(err.message) });
    }
  }

  onHost(msg) {
    switch (msg.type) {
      case "output":
        if (this.session(msg.id)) this.post(msg);
        break;
      case "exit":
        this.exited(msg.id, msg.exitCode);
        break;
      case "snapshot":
        this.snapshots.shift()?.(msg.sessions);
        break;
    }
  }

  // The host stopped (killed, or the machine is low on memory): the agents stopped with it
  onHostLost() {
    if (this.disposed) return;
    this.hostReady = undefined;
    for (const [, resolve] of this.snapshots.entries()) resolve({});
    this.snapshots = [];
    for (const [id, terminal] of this.terminals) {
      if (terminal.exited || !terminal.started) continue;
      terminal.exited = true;
      this.post({ type: "output", id, data: notice("The agents' host stopped. Press Enter to resume the session.") });
    }
  }

  onMessage(msg) {
    if (msg.id && !this.session(msg.id)) return; // a message about a session closed meanwhile
    switch (msg.type) {
      case "ready":
        this.replay();
        break;
      case "input": {
        const terminal = this.terminal(msg.id);
        if (terminal.exited) {
          if (msg.data === "\r") this.start(msg.id);
        } else if (terminal.started) this.send({ type: "input", id: msg.id, data: msg.data });
        break;
      }
      // The first size a pane reports is when its agent starts, so it starts at the right size
      case "resize": {
        const terminal = this.terminal(msg.id);
        terminal.size = { cols: msg.cols, rows: msg.rows };
        if (terminal.started) this.send({ type: "resize", id: msg.id, cols: msg.cols, rows: msg.rows });
        else this.start(msg.id);
        break;
      }
      case "activate":
        this.update(sessions.activate(this.state, msg.id));
        break;
      // What dragging in the list does (src/shared/drag.js says which)
      case "drop": // a session dropped on another
        if (typeof msg.id === "string" && typeof msg.target === "string") this.update(sessions.drop(this.state, msg.id, msg.target));
        break;
      case "dropEnd": // a session dropped below the last one
        if (typeof msg.id === "string") this.update(sessions.dropEnd(this.state, msg.id));
        break;
      case "unsplit": // a session dropped below the last one with Shift, out of its split
        if (typeof msg.id === "string") this.update(sessions.unsplit(this.state, msg.id));
        break;
      case "join": // a session dropped on another with Shift, into its group
        if (typeof msg.id === "string" && typeof msg.target === "string") return this.join(msg.id, msg.target);
        break;
      case "resizeSplit": // a border between two panes dragged, in a tree of the shape it names
        if (
          typeof msg.group === "string" &&
          typeof msg.shape === "string" &&
          Array.isArray(msg.path) &&
          msg.path.length <= layout.DEPTH &&
          msg.path.every((side) => side === "a" || side === "b") &&
          Number.isFinite(msg.ratio)
        ) {
          const next = sessions.resize(this.state, msg.group, msg.shape, msg.path, msg.ratio);
          if (next !== this.state) this.update(next);
        }
        // Answered, taken or not: the border stops waiting and shows the state
        if (Number.isSafeInteger(msg.request)) this.post({ type: "resized", request: msg.request });
        break;
      case "copied": // a pane's selection, the answer to the Copy asked for last (an older answer is ignored)
        if (!this.copying || msg.request !== this.copying.request || typeof msg.text !== "string") break;
        this.copied(this.copying.id, msg.request, msg.text);
        this.copying = undefined;
        break;
      case "palette":
        this.palette = msg.colors;
        break;
      case "title":
        if (this.session(msg.id).title !== msg.title) this.update(sessions.remember(this.state, msg.id, { title: String(msg.title).slice(0, 200) }));
        break;
      case "cwd": // the folder a terminal session's shell reported
        if (this.session(msg.id).kind === "terminal" && typeof msg.cwd === "string" && msg.cwd.length <= 1024 && this.session(msg.id).cwd !== msg.cwd) {
          this.update(sessions.remember(this.state, msg.id, { cwd: msg.cwd }));
        }
        break;
      case "close":
        this.close(msg.id);
        break;
      // A button of the title strip: only the commands it draws
      case "command":
        if (TITLE_BUTTONS.includes(msg.command) || SESSION_BUTTONS.includes(msg.command)) vscode.commands.executeCommand(msg.command);
        break;
      case "links": {
        // Which of a hovered line's paths exist: { path: the file it is }
        const paths = Array.isArray(msg.paths) ? msg.paths.filter((p) => typeof p === "string" && p.length <= 1024).slice(0, 10) : [];
        Promise.all(paths.map((p) => existingPath(p).then((found) => [p, found?.file]))).then((pairs) => {
          this.post({ type: "links", request: msg.request, files: Object.fromEntries(pairs.filter(([, file]) => file)) });
        });
        break;
      }
      case "openFile":
        if (typeof msg.file === "string" && msg.file.length <= 1024) {
          openPath(msg.file, Number(msg.line) || undefined, Number(msg.column) || undefined).catch((err) => this.log.error(`Could not open ${msg.file}`, err));
        }
        break;
      case "open":
        if (/^https?:\/\//i.test(msg.uri)) vscode.env.openExternal(vscode.Uri.parse(msg.uri));
        break;
      case "view":
        if (this.view && typeof msg.title === "string") this.view.title = msg.title.slice(0, 100);
        break;
      case "accounts":
        if (msg.message && typeof msg.message === "object") this.onAccounts(msg.message);
        break;
    }
  }

  async snapshot() {
    try {
      const channel = await this.connectHost();
      return await new Promise((resolve) => {
        this.snapshots.push(resolve);
        channel.send({ type: "snapshot" });
      });
    } catch {
      return {};
    }
  }

  // Send the page everything it draws: the sessions and each screen as the host has it. After a
  // window reload, this is where the agents that kept running show up again
  async replay() {
    if (!this.state.sessions.length) {
      this.state = sessions.add(this.state, AGENTS.claude.name);
      this.context.workspaceState.update("sessions", this.state);
    }
    this.watchCodex(); // a Codex session found no conversation before the window reloaded
    const running = await this.snapshot();
    const screens = {};
    const sizes = {}; // what size each screen was drawn at (a host from before this field has none)
    for (const [id, s] of Object.entries(running)) {
      if (!this.session(id)) {
        this.send({ type: "kill", id }); // its session was closed while the host was out of reach
        continue;
      }
      const terminal = this.terminal(id);
      terminal.started = true;
      terminal.exited = !s.running;
      screens[id] = s.screen;
      if (s.cols && s.rows) sizes[id] = { cols: s.cols, rows: s.rows };
    }
    this.post({ type: "init", state: this.state, screens, sizes });
  }

  start(id, fresh = false) {
    const terminal = this.terminal(id);
    if (this.session(id).kind === "terminal") return this.startTerminal(id, terminal);
    // Open the session's conversation again; the first time, a new one with an id of our own
    const agent = agentOf(this.session(id));
    let conversation = fresh ? undefined : this.session(id).conversation;
    const resume = !!conversation;
    const startedAt = Date.now();
    if (agent.id === "codex") {
      // Codex picks its own conversation id: a new one is looked for in its rollouts (watchCodex)
      this.update(sessions.remember(this.state, id, resume ? { startedAt } : { conversation: undefined, startedAt, cwd: cwd() }));
      if (!resume) this.watchCodex();
    } else {
      if (!conversation) conversation = newConversation();
      this.update(sessions.remember(this.state, id, { conversation, startedAt }));
    }
    Object.assign(terminal, { started: true, exited: false, resume, startedAt });
    const { file, args } = command(process.platform, agent, conversationArgs(agent, conversation, resume));
    this.createProcess(id, terminal, file, args);
  }

  startTerminal(id, terminal) {
    Object.assign(terminal, { started: true, exited: false, resume: false, startedAt: Date.now() });
    this.update(sessions.remember(this.state, id, { cwd: cwd() })); // until the shell says where it is
    const { file, args } = terminalCommand(process.platform, process.env);
    this.createProcess(id, terminal, file, args);
  }

  createProcess(id, terminal, file, args) {
    this.post({ type: "clear", id });
    this.send({
      type: "create",
      id,
      file,
      args,
      cwd: cwd(),
      env: env(process.env),
      cols: terminal.size.cols,
      rows: terminal.size.rows,
      scrollback: terminalSettings().scrollback,
    });
  }

  exited(id, exitCode) {
    const terminal = this.terminals.get(id);
    if (!terminal || !this.session(id)) return;
    if (this.session(id).kind === "terminal") {
      // Like the integrated terminal: a terminal that exits cleanly closes its session
      if (exitCode === 0) return this.close(id);
      terminal.exited = true;
      this.send({ type: "note", id, data: notice(`${TERMINAL.name} exited with code ${exitCode}. Press Enter to start it again.`) });
      return;
    }
    const agent = agentOf(this.session(id));
    // Leaving the agent closes its session, like a shell closes its terminal
    if (exitCode === 0) return this.close(id);
    // A conversation that can't be resumed (never saved, or deleted): start a new one
    if (terminal.resume && Date.now() - terminal.startedAt < 5000) return this.start(id, true);
    terminal.exited = true;
    // 127 is bash's "command not found"
    const reason =
      exitCode === 127
        ? `${agent.command} was not found on the PATH set up by ~/.bashrc. ${agent.install}`
        : `${agent.name} exited with code ${exitCode}`;
    this.send({ type: "note", id, data: notice(`${reason}. Press Enter to start it again.`) });
  }

  // Split Session...: which side, then what opens there. The last side used comes first, and the
  // kind of the session being split, so Enter, Enter repeats the last split
  async split(id = this.state.active) {
    const target = this.session(id);
    if (target && !sessions.canSplit(this.state, id)) return this.tooDeep();
    const current = !target ? "claude" : target.kind === "terminal" ? "terminal" : target.provider === "codex" ? "codex" : "claude";
    let dir;
    if (target) {
      dir = await this.pickSide("Split Session");
      if (!dir) return;
    }
    const icon = (name) => ({
      light: vscode.Uri.joinPath(this.context.extensionUri, "media", `${name}-light.svg`),
      dark: vscode.Uri.joinPath(this.context.extensionUri, "media", `${name}-dark.svg`),
    });
    const kinds = [
      { agent: "claude", label: AGENTS.claude.name, iconPath: icon("claude-code") },
      { agent: "codex", label: AGENTS.codex.name, iconPath: icon("codex") },
      { agent: "terminal", label: TERMINAL.name, iconPath: icon("terminal") },
    ];
    const ordered = [...kinds.filter((k) => k.agent === current), ...kinds.filter((k) => k.agent !== current)];
    const pick = await vscode.window.showQuickPick(
      ordered.map((k) => ({ ...k, description: target && k.agent === current ? "the same as this session" : "" })),
      { title: "Split Session", placeHolder: "Open what?" }
    );
    if (!pick) return;
    if (!target) return this.open(sessions.add, pick.agent === "terminal" ? "terminal" : undefined, pick.agent);
    if (!this.session(id)) return; // closed while the lists were open
    if (!sessions.canSplit(this.state, id)) return this.tooDeep();
    this.context.globalState.update("splitDirection", dir);
    const action = (state, name, kind, provider) => sessions.split(state, name, kind, provider, dir, id);
    this.open(action, pick.agent === "terminal" ? "terminal" : undefined, pick.agent);
  }

  // Which side a split goes, the side used last on top; undefined on Escape
  async pickSide(title) {
    const last = this.context.globalState.get("splitDirection");
    const order = [...DIRECTIONS.filter((d) => d.dir === last), ...DIRECTIONS.filter((d) => d.dir !== last)];
    const side = await vscode.window.showQuickPick(
      order.map((d) => ({ label: d.label, description: d.description, iconPath: new vscode.ThemeIcon(d.icon), dir: d.dir })),
      { title, placeHolder: "Which side?" }
    );
    return side?.dir;
  }

  // A session dropped on another to join its split: asks the side, as Split Session does, then joins it there
  async join(id, targetId) {
    const session = this.session(id);
    const target = this.session(targetId);
    if (!session || !target || session.group === target.group) return;
    if (!sessions.canSplit(this.state, targetId)) return this.tooDeep();
    const dir = await this.pickSide("Join Session");
    if (!dir || !this.session(id) || !this.session(targetId)) return; // Escape, or one closed while the list was open
    this.context.globalState.update("splitDirection", dir);
    this.update(sessions.join(this.state, id, targetId, dir));
  }

  tooDeep() {
    vscode.window.showInformationMessage(`This pane can't be split again: a split goes at most ${layout.DEPTH} levels deep. Split a pane nearer the outside.`);
  }

  // Copy and Paste in a pane's menu: the page has the selection, VS Code the clipboard
  copy(id = this.state.active) {
    if (!this.session(id)) return;
    this.copying = { id, request: crypto.randomBytes(8).toString("hex") }; // the one answer taken
    this.post({ type: "copy", id, request: this.copying.request });
  }

  // The selection to the clipboard; once it is there, the page clears it
  async copied(id, request, text) {
    if (!text) return;
    if (text.length > MAX_COPY) {
      vscode.window.showWarningMessage(`The selection is too long to copy from the menu (over ${MAX_COPY / 1024} KiB). Use Ctrl+Shift+C.`);
      return;
    }
    try {
      await vscode.env.clipboard.writeText(text);
    } catch (err) {
      this.log.error("Could not copy the selection", err);
      vscode.window.showWarningMessage("Could not copy the selection.");
      return;
    }
    this.post({ type: "copiedDone", id, request });
  }

  async paste(id = this.state.active) {
    const text = await vscode.env.clipboard.readText();
    if (text && this.session(id)) this.post({ type: "paste", id, text });
  }

  // The agent of a new session: the one asked for, else Claude Code
  open(action, kind, provider) {
    this.update(kind === "terminal" ? action(this.state, TERMINAL.name, "terminal") : action(this.state, agentOf({ provider }).name, undefined, provider));
    vscode.commands.executeCommand("dotagentsSidebar.view.focus");
  }

  close(id = this.state.active) {
    if (!this.session(id)) return;
    this.send({ type: "kill", id });
    this.terminals.delete(id);
    this.update(sessions.close(this.state, id));
  }

  // Codex tells nothing of its conversation, so the sessions still without one look for it in the
  // rollouts every few seconds (a rollout may only appear once the first prompt is sent), until
  // each has one
  watchCodex() {
    if (this.watching || !codexSessions.pending(this.state.sessions).length) return;
    this.watching = setInterval(() => {
      try {
        for (const [id, conversation] of Object.entries(codexSessions.discover(this.state.sessions))) {
          if (this.session(id)) this.update(sessions.remember(this.state, id, { conversation }));
        }
        if (codexSessions.pending(this.state.sessions).length) return;
      } catch (err) {
        this.log.error("Could not look for the Codex conversations", err);
      }
      clearInterval(this.watching);
      this.watching = undefined;
    }, 3000);
  }

  // A new process in the same conversation
  restart(id = this.state.active) {
    if (this.session(id)) this.start(id);
  }

  async rename(id = this.state.active) {
    const session = this.session(id);
    if (!session) return;
    const name = await vscode.window.showInputBox({ prompt: "Session name", value: session.name });
    if (name !== undefined && this.session(id)) this.update(sessions.rename(this.state, id, name));
  }

  async recolor(id = this.state.active) {
    if (!this.session(id)) return;
    // Like the terminal panel's Change Color: each color with a dot of itself, then a reset
    const name = (c) => c[0].toUpperCase() + c.slice(1);
    const dots = await this.dots();
    const items = [
      ...sessions.COLORS.map((c) => ({
        label: name(c),
        description: `terminal.ansi${name(c)}`,
        iconPath: dots[c] || new vscode.ThemeIcon("circle-filled"),
        color: c,
      })),
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "Reset to default", color: null },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Session color" });
    if (pick && this.session(id)) this.update(sessions.recolor(this.state, id, pick.color));
  }

  // A dot of each color as the theme paints it, for the color picker, which ignores the color of
  // a theme icon. They are files, one per color value, in the extension's storage
  async dots() {
    const dots = {};
    if (!this.palette) return dots;
    const folder = vscode.Uri.joinPath(this.context.globalStorageUri, "dots");
    await vscode.workspace.fs.createDirectory(folder);
    for (const [name, value] of Object.entries(this.palette)) {
      // A color of the theme as CSS gives it: #hex or rgb(a); anything else is skipped
      if (typeof value !== "string" || !/^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(value.trim())) continue;
      const file = vscode.Uri.joinPath(folder, `${crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)}.svg`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="5" fill="${value.trim()}"/></svg>`;
      try {
        await vscode.workspace.fs.stat(file);
      } catch {
        await vscode.workspace.fs.writeFile(file, Buffer.from(svg));
      }
      dots[name] = file;
    }
    return dots;
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  // The window is reloading or closing: let go of the host, which keeps the agents running
  dispose() {
    this.disposed = true;
    clearInterval(this.watching);
    // The host first: its channel closes even if anything after this fails
    this.hostReady?.then((channel) => channel.close()).catch(() => {});
    this.log.dispose();
  }

  html(webview) {
    const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...p));
    const nonce = crypto.randomBytes(16).toString("base64");
    const mark = (agent) => ({ name: agent.name, newline: agent.newline, icon: String(uri("media", `${agent.id === "codex" ? "codex" : "claude-code"}-dark.svg`)) });
    const agents = { claude: mark(AGENTS.claude), codex: mark(AGENTS.codex) };
    const terminal = { name: TERMINAL.name, icon: String(uri("media", "terminal.svg")) };
    const buttons = TITLE_BUTTONS.map((name) => {
      const { title, icon } = contributes.commands.find((c) => c.command === name);
      return { command: name, title, light: String(uri(icon.light)), dark: String(uri(icon.dark)) };
    });
    const panel = (name) => String(webview.asWebviewUri(vscode.Uri.joinPath(this.accounts.api.panelRoot, name)));
    // The panel's scripts load only when its tab first opens (webview/terminals/view.js), so nothing of it runs
    // while the agents are in use
    const accounts = this.accounts ? { icon: String(uri("media", "accounts.svg")), scripts: [panel("avatar.js"), panel("panel.js")], nonce } : null;
    const settings = JSON.stringify({ ...terminalSettings(), agents, terminal, buttons, workspace: workspaceName(), home: os.homedir(), keys: this.keys, accounts }).replace(/</g, "\\u003c");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri("node_modules", "@xterm", "xterm", "css", "xterm.css")}">
${accounts ? `<link rel="stylesheet" href="${panel("panel.css")}">` : ""}
<link rel="stylesheet" href="${uri("webview", "terminals", "view.css")}">
</head>
<body>
<div id="main">
<div id="header"></div>
<div id="panes">${accounts ? `<div id="accounts" class="pane accounts hidden"><main id="panel" class="panel" aria-live="polite"></main></div>` : ""}</div>
</div>
<div id="list"></div>
<script nonce="${nonce}">window.DOTAGENTS_SIDEBAR_SETTINGS = ${settings};</script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "xterm", "lib", "xterm.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-webgl", "lib", "addon-webgl.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-web-links", "lib", "addon-web-links.js")}"></script>
<script nonce="${nonce}" src="${uri("src", "shared", "keys.js")}"></script>
<script nonce="${nonce}" src="${uri("webview", "terminals", "links.js")}"></script>
<script nonce="${nonce}" src="${uri("webview", "terminals", "cwd.js")}"></script>
<script nonce="${nonce}" src="${uri("src", "shared", "drag.js")}"></script>
<script nonce="${nonce}" src="${uri("src", "shared", "layout.js")}"></script>
<script nonce="${nonce}" src="${uri("webview", "terminals", "view.js")}"></script>
</body>
</html>`;
  }
}

function terminalOptions(context, agent) {
  const { file, args } = command(process.platform, agent);
  const icon = agent.id === "codex" ? "codex" : "claude-code";
  return {
    name: agent.name,
    shellPath: file,
    shellArgs: args,
    iconPath: {
      light: vscode.Uri.joinPath(context.extensionUri, "media", `${icon}-light.svg`),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", `${icon}-dark.svg`),
    },
  };
}

async function activate(context) {
  const view = new SidebarView(context);
  view.workOutKeys().catch((err) => view.log.error("Could not work out the shortcut keys", err));
  // Before the view is drawn, so the page is built once, with the accounts tab or without it
  try {
    view.connectAccounts();
  } catch (err) {
    view.log.error("Could not set up the accounts", err);
  }
  // A command run from a session's context menu gets that session; from the title bar, the active one
  const onSession = (name, run) => vscode.commands.registerCommand(`dotagentsSidebar.${name}`, (arg) => run(arg?.sessionId));
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider("dotagentsSidebar.view", view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!WATCHED.some((key) => event.affectsConfiguration(key))) return;
      await view.workOutKeys().catch(() => {});
      view.reload();
    }),
    // The view reads the theme's colors when it loads
    vscode.window.onDidChangeActiveColorTheme(() => view.reload()),
    vscode.commands.registerCommand("dotagentsSidebar.new", () => view.open(sessions.add)),
    vscode.commands.registerCommand("dotagentsSidebar.new.codex", () => view.open(sessions.add, undefined, "codex")),
    vscode.commands.registerCommand("dotagentsSidebar.newTerminal", () => view.open(sessions.add, "terminal")),
    // The same Split Session... from the amber button, the palette and the menus
    onSession("split", (id) => view.split(id)),
    onSession("copy", (id) => view.copy(id)),
    onSession("paste", (id) => view.paste(id)),
    onSession("close", (id) => view.close(id)),
    onSession("restart", (id) => view.restart(id)),
    onSession("rename", (id) => view.rename(id)),
    onSession("recolor", (id) => view.recolor(id)),
    vscode.window.registerTerminalProfileProvider("dotagentsSidebar.profile.claude", {
      provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions(context, AGENTS.claude)),
    }),
    vscode.window.registerTerminalProfileProvider("dotagentsSidebar.profile.codex", {
      provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions(context, AGENTS.codex)),
    })
  );
}

module.exports = { activate, deactivate() {} };
