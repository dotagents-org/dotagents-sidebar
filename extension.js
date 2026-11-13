const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { spawn } = require("child_process");
const host = require("./host");
const { PROVIDERS, command, conversationArgs, env, findCodexSessions, newer } = require("./providers");
const sessions = require("./sessions");
const keys = require("./media/keys.js");

const { startAccounts } = require("./accounts");
const SKIP_SHELL = require("./skip-shell.json");

// One host per workspace and protocol (host.js), not per version of the extension: an update
// reaches the host the old version started, and its agents keep running. An empty window has
// nothing to come back to, so its host is its own
function hostKey() {
  const workspace = vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.[0]?.uri;
  const id = workspace ? workspace.toString() : `window-${vscode.env.sessionId}`;
  const hash = crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
  return `p${host.PROTOCOL}-${hash}`;
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

// The workspace's name without what VS Code adds in a remote window (" [WSL: Ubuntu]")
function workspaceName() {
  return (vscode.workspace.name || "").replace(/\s*\[[^\]]*\]$/, "");
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
    renderer: vscode.workspace.getConfiguration("dotagentsSidebar").get("renderer") || "webgl",
  };
}

class SidebarView {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.state = sessions.restore(context.workspaceState.get("sessions"), PROVIDERS.map((p) => p.id));
    // Session id -> what the extension knows of its agent; the process and the screen live in the host
    this.terminals = new Map();
    this.snapshots = []; // the replies the host still owes, in order
    this.hostReady = undefined;
    this.disposed = false;
    this.keys = undefined; // the keys VS Code keeps, once worked out
    this.log = vscode.window.createOutputChannel("dotagents-sidebar");
    this.accounts = undefined; // the Claude accounts (accounts.js), when dotagents is set up here
  }

  // With dotagents set up on this side, the accounts are a fixed tab, the first in the list:
  // accounts.js talks to the server, this view draws the panel and passes the messages both ways.
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

  // The keys that go to VS Code while a session has focus (media/keys.js): the terminal's rule,
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
    this.log.appendLine(`${new Date().toISOString()} ${this.keys.length} keys go to VS Code, from ${source}: ${this.keys.join(" ")}`);
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
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const modules = vscode.Uri.joinPath(this.context.extensionUri, "node_modules");
    this.view.webview.options = { enableScripts: true, localResourceRoots: [media, modules, ...(this.accounts ? [this.accounts.api.panelRoot] : [])] };
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
      case "palette":
        this.palette = msg.colors;
        break;
      case "title":
        if (this.session(msg.id).title !== msg.title) this.update(sessions.remember(this.state, msg.id, { title: String(msg.title).slice(0, 200) }));
        break;
      case "close":
        this.close(msg.id);
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
    vscode.commands.executeCommand("dotagentsSidebar.view.focus");
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
    this.log.dispose();
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
    const panel = (name) => String(webview.asWebviewUri(vscode.Uri.joinPath(this.accounts.api.panelRoot, name)));
    // The panel's scripts load only when its tab first opens (media/view.js), so nothing of it runs
    // while the agents are in use
    const accounts = this.accounts ? { icon: String(uri("media", "accounts.svg")), scripts: [panel("avatar.js"), panel("panel.js")], nonce } : null;
    const settings = JSON.stringify({ ...terminalSettings(), providers, workspace: workspaceName(), keys: this.keys, accounts }).replace(/</g, "\\u003c");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri("node_modules", "@xterm", "xterm", "css", "xterm.css")}">
${accounts ? `<link rel="stylesheet" href="${panel("panel.css")}">` : ""}
<link rel="stylesheet" href="${uri("media", "view.css")}">
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
<script nonce="${nonce}" src="${uri("media", "keys.js")}"></script>
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
const RELEASES = "https://api.github.com/repos/dotagents-org/dotagents-sidebar/releases/latest";
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
    `dotagents-sidebar ${latest} is available (you have ${current}).`,
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
        `dotagents-sidebar ${latest} is installed. Reload the window to use it.`,
        "Reload"
      );
      if (reload) vscode.commands.executeCommand("workbench.action.reloadWindow");
    } catch (err) {
      const open = await vscode.window.showErrorMessage(`Could not install dotagents-sidebar ${latest}: ${err.message}`, "Open release");
      if (open) vscode.env.openExternal(vscode.Uri.parse(release.html_url));
    }
  }
}

async function activate(context) {
  checkForUpdate(context).catch(() => {}); // offline or rate limited: try again tomorrow

  const view = new SidebarView(context);
  view.workOutKeys().catch((err) => view.log.appendLine(`Could not work out the shortcut keys: ${err.message}`));
  // Before the view is drawn, so the page is built once, with the accounts tab or without it
  try {
    view.connectAccounts();
  } catch (err) {
    view.log.appendLine(`Could not set up the Claude accounts: ${err.message}`);
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
    vscode.commands.registerCommand("dotagentsSidebar.split", () => view.open(sessions.split)),
    // The + menu, like the terminal panel's: a session with a chosen agent, opened or split
    ...PROVIDERS.flatMap((provider) => [
      vscode.commands.registerCommand(`dotagentsSidebar.new.${provider.id}`, () => view.open(sessions.add, provider.id)),
      vscode.commands.registerCommand(`dotagentsSidebar.split.${provider.id}`, () => view.open(sessions.split, provider.id)),
    ]),
    onSession("close", (id) => view.close(id)),
    onSession("restart", (id) => view.restart(id)),
    onSession("rename", (id) => view.rename(id)),
    onSession("recolor", (id) => view.recolor(id)),
    ...PROVIDERS.map((provider) =>
      vscode.window.registerTerminalProfileProvider(`dotagentsSidebar.profile.${provider.id}`, {
        provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions(context, provider)),
      })
    )
  );
}

module.exports = { activate, deactivate() {} };
