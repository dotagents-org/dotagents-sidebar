const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { spawn } = require("child_process");
const host = require("./host");
const { PROVIDERS, command, conversationArgs, env, findCodexSessions, newer } = require("./providers");
const sessions = require("./sessions");

// One host per workspace and version of the extension. An empty window has nothing to come
// back to, so its host is its own
function hostKey(context) {
  const workspace = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0]?.uri;
  const id = workspace ? workspace.toString() : `window-${vscode.env.sessionId}`;
  const hash = crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
  return `${context.extension.packageJSON.version}-${hash}`;
}

// Codex's saved conversations: the first line of each rollout has its id, folder and start time
function codexRollouts(since) {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  const rollouts = [];
  let files = [];
  try {
    files = fs.readdirSync(root, { recursive: true }).filter((f) => /rollout-.*\.jsonl$/.test(f));
  } catch {
    return rollouts; // no Codex conversations yet
  }
  for (const file of files) {
    const full = path.join(root, file);
    try {
      if (fs.statSync(full).mtimeMs < since) continue;
      const first = fs.readFileSync(full, "utf8").split("\n", 1)[0];
      const { payload } = JSON.parse(first);
      rollouts.push({ id: payload.id, cwd: payload.cwd, started: Date.parse(payload.timestamp) });
    } catch {
      // a rollout being written, or of another format: skip it
    }
  }
  return rollouts;
}

function cwd() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && folder.uri.scheme === "file" ? folder.uri.fsPath : os.homedir();
}

// The view mirrors the integrated terminal's font settings, so text looks the way the user
// already tuned it for their screen
const WATCHED = [
  "agentsSidebar",
  "editor.fontFamily",
  "editor.fontSize",
  ...["fontFamily", "fontSize", "lineHeight", "letterSpacing", "fontWeight", "fontWeightBold", "minimumContrastRatio", "scrollback"].map(
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
    // Not the terminal's gpuAcceleration: block and box characters only draw seamlessly
    // with the WebGL renderer (DOM leaves hairlines)
    renderer: vscode.workspace.getConfiguration("agentsSidebar").get("renderer") || "webgl",
  };
}

class AgentsView {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.state = sessions.restore(context.workspaceState.get("sessions"), PROVIDERS.map((p) => p.id));
    // Session id -> what the extension knows of its agent; the process and the screen live in the host
    this.terminals = new Map();
    this.snapshots = []; // the replies the host still owes, in order
    this.hostReady = undefined;
    this.disposed = false;
  }

  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const modules = vscode.Uri.joinPath(this.context.extensionUri, "node_modules");
    view.webview.options = { enableScripts: true, localResourceRoots: [media, modules] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  // Rebuild the page with the new settings; the running agents are kept and replayed
  reload() {
    if (this.view) this.view.webview.html = this.html(this.view.webview);
  }

  update(state) {
    this.state = state;
    this.context.workspaceState.update("sessions", state);
    this.post({ type: "state", state });
    this.describe();
  }

  // The title reads like a terminal tab: the agent, then the workspace and the session's own
  // name, when it has one other than the agent's
  describe() {
    if (!this.view) return;
    const session = this.session(this.state.active);
    const provider = session && PROVIDERS.find((p) => p.id === session.provider);
    this.view.title = provider ? provider.name : "Agents";
    const named = session && session.name !== provider.name ? session.name : "";
    this.view.description = [vscode.workspace.name, named].filter(Boolean).join(" · ");
  }

  session(id) {
    return this.state.sessions.find((s) => s.id === id);
  }

  terminal(id) {
    let terminal = this.terminals.get(id);
    if (!terminal) {
      const provider = PROVIDERS.find((p) => p.id === this.session(id).provider);
      terminal = { provider, started: false, exited: false, resume: false, startedAt: 0, size: { cols: 80, rows: 24 } };
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
    const socket = host.socketPath(hostKey(this.context));
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
    // Detached, so it outlives the extension; ELECTRON_RUN_AS_NODE makes VS Code's own
    // executable run it as plain Node on the desktop
    const child = spawn(process.execPath, [path.join(__dirname, "host.js"), socket, vscode.env.appRoot], {
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
      if (msg.id) this.post({ type: "output", id: msg.id, data: `\r\n\x1b[2m[${err.message}]\x1b[0m\r\n` });
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
      this.post({ type: "output", id, data: "\r\n\x1b[2m[The agents' host stopped. Press Enter to resume the session.]\x1b[0m\r\n" });
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
      case "close":
        this.close(msg.id);
        break;
      case "open":
        if (/^https?:\/\//i.test(msg.uri)) vscode.env.openExternal(vscode.Uri.parse(msg.uri));
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
      this.state = this.added(sessions.add);
      this.context.workspaceState.update("sessions", this.state);
    }
    const running = await this.snapshot();
    const screens = {};
    for (const [id, s] of Object.entries(running)) {
      if (!this.session(id)) {
        this.send({ type: "kill", id }); // its session was closed while the host was out of reach
        continue;
      }
      const terminal = this.terminal(id);
      terminal.started = true;
      terminal.exited = !s.running;
      screens[id] = s.screen;
    }
    this.post({ type: "init", state: this.state, screens });
    this.describe();
  }

  // Codex picks its own conversation ids: find the ones of the sessions that don't know theirs
  findCodexConversations() {
    const pending = this.state.sessions.filter((s) => s.provider === "codex" && s.startedAt && !s.conversation);
    if (!pending.length) return;
    const since = Math.min(...pending.map((s) => s.startedAt));
    const found = findCodexSessions(pending, codexRollouts(since), cwd());
    let state = this.state;
    for (const [id, conversation] of Object.entries(found)) state = sessions.remember(state, id, { conversation });
    if (state !== this.state) this.update(state);
  }

  start(id, fresh = false) {
    const terminal = this.terminal(id);
    const { provider } = terminal;
    // Open the session's conversation again; the first time, a new one with an id of our own
    if (provider.id === "codex") this.findCodexConversations();
    let conversation = fresh ? undefined : this.session(id).conversation;
    const resume = !!conversation;
    if (!conversation && provider.newConversation) conversation = provider.newConversation();
    const startedAt = Date.now();
    this.update(sessions.remember(this.state, id, { conversation, startedAt }));
    Object.assign(terminal, { started: true, exited: false, resume, startedAt });
    const { file, args } = command(provider, process.platform, conversationArgs(provider, conversation, resume));
    this.post({ type: "clear", id });
    this.send({
      type: "create",
      id,
      file,
      args,
      cwd: cwd(),
      env: env(provider, process.env),
      cols: terminal.size.cols,
      rows: terminal.size.rows,
      scrollback: provider.scrollback ? terminalSettings().scrollback : 0,
    });
  }

  exited(id, exitCode) {
    const terminal = this.terminals.get(id);
    if (!terminal || !this.session(id)) return;
    // Leaving the agent closes its session, like a shell closes its terminal
    if (exitCode === 0) return this.close(id);
    // A conversation that can't be resumed (never saved, or deleted): start a new one
    if (terminal.resume && Date.now() - terminal.startedAt < 5000) return this.start(id, true);
    terminal.exited = true;
    const { provider } = terminal;
    // 127 is bash's "command not found"
    const reason =
      exitCode === 127
        ? `${provider.command} was not found on the PATH set up by ~/.bashrc. ${provider.install}`
        : `${provider.name} exited with code ${exitCode}`;
    this.send({ type: "note", id, data: `\r\n\x1b[2m[${reason}. Press Enter to start it again.]\x1b[0m\r\n` });
  }

  // The state after `action` (add or split) opened a session of the agent used last
  added(action, providerId) {
    const known = (id) => PROVIDERS.find((p) => p.id === id);
    const provider = known(providerId) || known(this.context.globalState.get("lastProvider")) || PROVIDERS[0];
    this.context.globalState.update("lastProvider", provider.id);
    return action(this.state, provider.id, provider.name);
  }

  open(action, providerId) {
    this.update(this.added(action, providerId));
    vscode.commands.executeCommand("agentsSidebar.view.focus");
  }

  close(id = this.state.active) {
    if (!this.session(id)) return;
    this.send({ type: "kill", id });
    this.terminals.delete(id);
    this.update(sessions.close(this.state, id));
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
    const color = await vscode.window.showQuickPick(sessions.COLORS, { placeHolder: "Session color" });
    if (color && this.session(id)) this.update(sessions.recolor(this.state, id, color));
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  // The window is reloading or closing: let go of the host, which keeps the agents running
  dispose() {
    this.disposed = true;
    this.hostReady?.then((channel) => channel.close()).catch(() => {});
  }

  html(webview) {
    const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...p));
    const nonce = crypto.randomBytes(16).toString("base64");
    const providers = Object.fromEntries(
      PROVIDERS.map((p) => [
        p.id,
        { name: p.name, scrollback: !!p.scrollback, newline: p.newline, icon: String(uri("media", `${p.id}-dark.svg`)) },
      ])
    );
    const settings = JSON.stringify({ ...terminalSettings(), providers }).replace(/</g, "\\u003c");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri("node_modules", "@xterm", "xterm", "css", "xterm.css")}">
<link rel="stylesheet" href="${uri("media", "view.css")}">
</head>
<body>
<div id="panes"></div>
<div id="list"></div>
<script nonce="${nonce}">window.AGENTS_SETTINGS = ${settings};</script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "xterm", "lib", "xterm.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-webgl", "lib", "addon-webgl.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-web-links", "lib", "addon-web-links.js")}"></script>
<script nonce="${nonce}" src="${uri("media", "view.js")}"></script>
</body>
</html>`;
  }
}

function terminalOptions(context, provider) {
  const { file, args } = command(provider, process.platform);
  return {
    name: provider.name,
    shellPath: file,
    shellArgs: args,
    iconPath: {
      light: vscode.Uri.joinPath(context.extensionUri, "media", `${provider.id}-light.svg`),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", `${provider.id}-dark.svg`),
    },
  };
}

// The extension is not on the Marketplace, so VS Code can't update it: once a day, look for
// a newer GitHub release and offer to install its .vsix
const RELEASES = "https://api.github.com/repos/gabrieldulolmarques/dotagents-sidebar/releases/latest";
const DAY = 24 * 60 * 60 * 1000;

async function checkForUpdate(context) {
  const state = context.globalState;
  if (Date.now() - state.get("lastUpdateCheck", 0) < DAY) return;
  await state.update("lastUpdateCheck", Date.now());

  const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return;
  const release = await res.json();
  const latest = String(release.tag_name).replace(/^v/, "");
  const current = context.extension.packageJSON.version;
  const asset = release.assets?.find((a) => a.name.endsWith(".vsix"));
  if (!asset || !newer(latest, current) || state.get("ignoredVersion") === latest) return;

  const choice = await vscode.window.showInformationMessage(
    `Agents Sidebar ${latest} is available (you have ${current}).`,
    "Install",
    "Release notes",
    "Skip this version"
  );
  if (choice === "Release notes") vscode.env.openExternal(vscode.Uri.parse(release.html_url));
  else if (choice === "Skip this version") await state.update("ignoredVersion", latest);
  else if (choice === "Install") {
    try {
      const vsix = await fetch(asset.browser_download_url);
      if (!vsix.ok) throw new Error(`download failed (${vsix.status})`);
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      const file = vscode.Uri.joinPath(context.globalStorageUri, asset.name);
      await vscode.workspace.fs.writeFile(file, new Uint8Array(await vsix.arrayBuffer()));
      await vscode.commands.executeCommand("workbench.extensions.installExtension", file);
      const reload = await vscode.window.showInformationMessage(
        `Agents Sidebar ${latest} is installed. Reload the window to use it.`,
        "Reload"
      );
      if (reload) vscode.commands.executeCommand("workbench.action.reloadWindow");
    } catch (err) {
      const open = await vscode.window.showErrorMessage(`Could not install Agents Sidebar ${latest}: ${err.message}`, "Open release");
      if (open) vscode.env.openExternal(vscode.Uri.parse(release.html_url));
    }
  }
}

function activate(context) {
  checkForUpdate(context).catch(() => {}); // offline or rate limited: try again tomorrow

  const view = new AgentsView(context);
  // A command run from a session's context menu gets that session; from the title bar, the active one
  const onSession = (name, run) => vscode.commands.registerCommand(`agentsSidebar.${name}`, (arg) => run(arg?.sessionId));
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider("agentsSidebar.view", view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (WATCHED.some((key) => event.affectsConfiguration(key))) view.reload();
    }),
    // The view reads the theme's colors when it loads
    vscode.window.onDidChangeActiveColorTheme(() => view.reload()),
    vscode.commands.registerCommand("agentsSidebar.new", () => view.open(sessions.add)),
    vscode.commands.registerCommand("agentsSidebar.split", () => view.open(sessions.split)),
    // The + menu, like the terminal panel's: a session with a chosen agent, opened or split
    ...PROVIDERS.flatMap((provider) => [
      vscode.commands.registerCommand(`agentsSidebar.new.${provider.id}`, () => view.open(sessions.add, provider.id)),
      vscode.commands.registerCommand(`agentsSidebar.split.${provider.id}`, () => view.open(sessions.split, provider.id)),
    ]),
    onSession("close", (id) => view.close(id)),
    onSession("restart", (id) => view.restart(id)),
    onSession("rename", (id) => view.rename(id)),
    onSession("recolor", (id) => view.recolor(id)),
    ...PROVIDERS.map((provider) =>
      vscode.window.registerTerminalProfileProvider(`agentsSidebar.profile.${provider.id}`, {
        provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions(context, provider)),
      })
    )
  );
}

module.exports = { activate, deactivate() {} };
