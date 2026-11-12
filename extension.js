const crypto = require("crypto");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");
const { PROVIDERS, command, env, newer } = require("./providers");
const sessions = require("./sessions");

// node-pty ships inside VS Code (node_modules on the server, asar.unpacked on desktop)
let ptyModule;
function loadPty() {
  if (ptyModule) return ptyModule;
  const root = vscode.env.appRoot;
  const candidates = [
    path.join(root, "node_modules", "node-pty"),
    path.join(root, "node_modules.asar.unpacked", "node-pty"),
    path.join(root, "node_modules.asar", "node-pty"),
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      ptyModule = require(candidate);
      return ptyModule;
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(`node-pty not found in VS Code:\n${errors.join("\n")}`);
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
    // Session id -> its process and a headless copy of its screen, serialized to redraw the
    // view when VS Code rebuilds it
    this.terminals = new Map();
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
  }

  session(id) {
    return this.state.sessions.find((s) => s.id === id);
  }

  terminal(id) {
    let terminal = this.terminals.get(id);
    if (!terminal) {
      const provider = PROVIDERS.find((p) => p.id === this.session(id).provider);
      const scrollback = provider.scrollback ? terminalSettings().scrollback : 0;
      const screen = new Terminal({ cols: 80, rows: 24, scrollback, allowProposedApi: true });
      const serializer = new SerializeAddon();
      screen.loadAddon(serializer);
      terminal = { provider, screen, serializer, pty: undefined, exited: false, size: { cols: 80, rows: 24 } };
      this.terminals.set(id, terminal);
    }
    return terminal;
  }

  onMessage(msg) {
    if (msg.id && !this.session(msg.id)) return; // a message about a session closed meanwhile
    switch (msg.type) {
      case "ready":
        if (!this.state.sessions.length) this.state = this.added(sessions.add);
        this.replay();
        break;
      case "input": {
        const terminal = this.terminal(msg.id);
        if (terminal.pty) terminal.pty.write(msg.data);
        else if (terminal.exited && msg.data === "\r") this.start(msg.id);
        break;
      }
      // The first size a pane reports is when its agent starts, so it starts at the right size
      case "resize": {
        const terminal = this.terminal(msg.id);
        terminal.size = { cols: msg.cols, rows: msg.rows };
        terminal.screen.resize(msg.cols, msg.rows);
        if (terminal.pty) terminal.pty.resize(msg.cols, msg.rows);
        else if (!terminal.exited) this.start(msg.id);
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

  // Send the page everything it draws: the sessions and each screen as it is now
  async replay() {
    const screens = {};
    await Promise.all(
      [...this.terminals].map(
        ([id, terminal]) =>
          // Wait for the pending output to be parsed
          new Promise((resolve) =>
            terminal.screen.write("", () => {
              screens[id] = terminal.serializer.serialize();
              resolve();
            })
          )
      )
    );
    this.context.workspaceState.update("sessions", this.state);
    this.post({ type: "init", state: this.state, screens });
  }

  output(id, data) {
    this.terminal(id).screen.write(data);
    this.post({ type: "output", id, data });
  }

  start(id) {
    const terminal = this.terminal(id);
    let pty;
    try {
      pty = loadPty();
    } catch (err) {
      terminal.exited = true;
      this.output(id, `\r\n${err.message.replace(/\n/g, "\r\n")}\r\n`);
      return;
    }
    const { provider } = terminal;
    const { file, args } = command(provider, process.platform);
    terminal.exited = false;
    terminal.screen.reset();
    this.post({ type: "clear", id });
    const proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: terminal.size.cols,
      rows: terminal.size.rows,
      cwd: cwd(),
      env: env(provider, process.env),
    });
    terminal.pty = proc;
    proc.onData((data) => {
      if (terminal.pty === proc) this.output(id, data);
    });
    proc.onExit(({ exitCode }) => {
      if (terminal.pty !== proc) return;
      terminal.pty = undefined;
      // Leaving the agent closes its session, like a shell closes its terminal
      if (exitCode === 0) return this.close(id);
      terminal.exited = true;
      // 127 is bash's "command not found"
      const reason =
        exitCode === 127
          ? `${provider.command} was not found on the PATH set up by ~/.bashrc. ${provider.install}`
          : `${provider.name} exited with code ${exitCode}`;
      this.output(id, `\r\n\x1b[2m[${reason}. Press Enter to start it again.]\x1b[0m\r\n`);
    });
  }

  stop(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    const old = terminal.pty;
    terminal.pty = undefined;
    if (old) old.kill();
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
    this.stop(id);
    const terminal = this.terminals.get(id);
    if (terminal) terminal.screen.dispose();
    this.terminals.delete(id);
    this.update(sessions.close(this.state, id));
  }

  restart(id = this.state.active) {
    if (!this.session(id)) return;
    this.stop(id);
    this.start(id);
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

  dispose() {
    for (const [id, terminal] of this.terminals) {
      this.stop(id);
      terminal.screen.dispose();
    }
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
const RELEASES = "https://api.github.com/repos/gabrieldulolmarques/agents-sidebar/releases/latest";
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
