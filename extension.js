const os = require("os");
const path = require("path");
const vscode = require("vscode");

const NAME = "opencode";
const REPLAY_LIMIT = 512 * 1024; // output kept per session to redraw the view after it is rebuilt

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

function command() {
  if (process.platform === "win32") {
    return { file: "powershell.exe", args: ["-NoLogo", "-Command", "opencode"] };
  }
  // -i loads ~/.bashrc, where opencode's bin folder enters the PATH
  return { file: "bash", args: ["-ic", "opencode"] };
}

function cwd() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && folder.uri.scheme === "file" ? folder.uri.fsPath : os.homedir();
}

function fontSettings() {
  const term = vscode.workspace.getConfiguration("terminal.integrated");
  const editor = vscode.workspace.getConfiguration("editor");
  return {
    fontFamily: term.get("fontFamily") || editor.get("fontFamily") || "monospace",
    fontSize: term.get("fontSize") || editor.get("fontSize") || 14,
    lineHeight: term.get("lineHeight") || 1,
  };
}

class Session {
  constructor(id, number) {
    this.id = id;
    this.number = number;
    this.pty = undefined;
    this.replay = "";
  }
}

class OpencodeView {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.sessions = new Map();
    this.active = undefined;
    this.nextId = 1;
    this.size = { cols: 80, rows: 24 };
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

  onMessage(msg) {
    const session = msg.id !== undefined ? this.sessions.get(msg.id) : undefined;
    switch (msg.type) {
      case "ready":
        this.size = { cols: msg.cols, rows: msg.rows };
        if (this.sessions.size === 0) {
          this.create();
        } else {
          this.post({ type: "init", sessions: this.list(), active: this.active });
          for (const s of this.sessions.values()) {
            if (s.replay) this.post({ type: "output", id: s.id, data: s.replay });
            if (s.pty) s.pty.resize(msg.cols, msg.rows);
          }
        }
        break;
      case "create":
        this.create();
        break;
      case "close":
        if (session) this.close(session);
        break;
      case "activate":
        if (session) this.active = session.id;
        break;
      case "input":
        if (!session) break;
        if (session.pty) session.pty.write(msg.data);
        else if (msg.data === "\r") this.start(session);
        break;
      case "resize":
        this.size = { cols: msg.cols, rows: msg.rows };
        for (const s of this.sessions.values()) if (s.pty) s.pty.resize(msg.cols, msg.rows);
        break;
    }
  }

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, number: s.number }));
  }

  // Lowest free number, so tabs read 1, 2, 3 and reuse the numbers of closed ones
  freeNumber() {
    const used = new Set([...this.sessions.values()].map((s) => s.number));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  create() {
    const session = new Session(this.nextId++, this.freeNumber());
    this.sessions.set(session.id, session);
    this.active = session.id;
    this.post({ type: "add", session: { id: session.id, number: session.number } });
    this.start(session);
  }

  close(session) {
    this.sessions.delete(session.id);
    const proc = session.pty;
    session.pty = undefined;
    if (proc) proc.kill();
    this.post({ type: "remove", id: session.id });
    if (this.active === session.id) this.active = [...this.sessions.keys()].pop();
    if (this.sessions.size === 0) this.create();
  }

  start(session) {
    let pty;
    try {
      pty = loadPty();
    } catch (err) {
      this.post({ type: "output", id: session.id, data: `\r\n${err.message.replace(/\n/g, "\r\n")}\r\n` });
      return;
    }
    const { file, args } = command();
    session.replay = "";
    this.post({ type: "clear", id: session.id });
    const proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: this.size.cols,
      rows: this.size.rows,
      cwd: cwd(),
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "vscode" },
    });
    session.pty = proc;
    proc.onData((data) => {
      session.replay = (session.replay + data).slice(-REPLAY_LIMIT);
      this.post({ type: "output", id: session.id, data });
    });
    proc.onExit(({ exitCode }) => {
      if (session.pty !== proc) return;
      session.pty = undefined;
      const data = `\r\n\x1b[2m[opencode exited with code ${exitCode}. Press Enter to start it again.]\x1b[0m\r\n`;
      session.replay += data;
      this.post({ type: "output", id: session.id, data });
    });
  }

  newSession() {
    this.create();
    this.focus();
  }

  restart() {
    const session = this.sessions.get(this.active);
    if (!session) return this.newSession();
    const old = session.pty;
    session.pty = undefined;
    if (old) old.kill();
    this.start(session);
    this.focus();
  }

  focus() {
    vscode.commands.executeCommand("opencodeSidebar.view.focus");
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  dispose() {
    for (const s of this.sessions.values()) if (s.pty) s.pty.kill();
  }

  html(webview) {
    const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...p));
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
    const settings = JSON.stringify(fontSettings()).replace(/</g, "\\u003c");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri("node_modules", "@xterm", "xterm", "css", "xterm.css")}">
<link rel="stylesheet" href="${uri("media", "view.css")}">
</head>
<body>
<nav id="tabs"><div id="tab-list" role="tablist"></div><button id="new" title="New session" aria-label="New session">+</button></nav>
<main id="terminals"></main>
<script nonce="${nonce}">window.OPENCODE_SETTINGS = ${settings};</script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "xterm", "lib", "xterm.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js")}"></script>
<script nonce="${nonce}" src="${uri("media", "view.js")}"></script>
</body>
</html>`;
  }
}

function terminalOptions(context) {
  const { file, args } = command();
  return {
    name: NAME,
    shellPath: file,
    shellArgs: args,
    iconPath: {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "opencode-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "opencode-dark.svg"),
    },
  };
}

function activate(context) {
  const provider = new OpencodeView(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider("opencodeSidebar.view", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("opencodeSidebar.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("opencodeSidebar.restart", () => provider.restart()),
    vscode.commands.registerCommand("opencodeSidebar.openInTerminal", () =>
      vscode.window.createTerminal(terminalOptions(context)).show()
    ),
    vscode.window.registerTerminalProfileProvider("opencodeSidebar.profile", {
      provideTerminalProfile: () => new vscode.TerminalProfile(terminalOptions(context)),
    })
  );
}

module.exports = { activate, deactivate() {} };
