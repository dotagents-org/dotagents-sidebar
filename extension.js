const os = require("os");
const path = require("path");
const vscode = require("vscode");

const NAME = "OpenCode";
const REPLAY_LIMIT = 512 * 1024; // output kept to redraw the view after it is rebuilt

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
  // -i loads ~/.bashrc, where OpenCode's bin folder enters the PATH
  return { file: "bash", args: ["-ic", "opencode"] };
}

function cwd() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && folder.uri.scheme === "file" ? folder.uri.fsPath : os.homedir();
}

// The view mirrors the integrated terminal's own settings, so it renders the way the user
// already tuned their terminal for their screen (renderer, font, spacing)
const WATCHED = ["terminal.integrated", "editor.fontFamily", "editor.fontSize"];

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
    // "auto" and "on" use WebGL (falling back to the DOM renderer), "off" uses the DOM renderer
    gpuAcceleration: term.get("gpuAcceleration") || "auto",
  };
}

class OpencodeView {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.pty = undefined;
    this.replay = "";
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

  // Rebuild the page with the new settings; the running OpenCode is kept and replayed
  reload() {
    if (this.view) this.view.webview.html = this.html(this.view.webview);
  }

  onMessage(msg) {
    switch (msg.type) {
      case "ready":
        this.size = { cols: msg.cols, rows: msg.rows };
        if (this.pty) {
          if (this.replay) this.post({ type: "output", data: this.replay });
          this.pty.resize(msg.cols, msg.rows);
        } else {
          this.start();
        }
        break;
      case "input":
        if (this.pty) this.pty.write(msg.data);
        else if (msg.data === "\r") this.start();
        break;
      case "resize":
        this.size = { cols: msg.cols, rows: msg.rows };
        if (this.pty) this.pty.resize(msg.cols, msg.rows);
        break;
    }
  }

  start() {
    let pty;
    try {
      pty = loadPty();
    } catch (err) {
      this.post({ type: "output", data: `\r\n${err.message.replace(/\n/g, "\r\n")}\r\n` });
      return;
    }
    const { file, args } = command();
    this.replay = "";
    this.post({ type: "clear" });
    const proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: this.size.cols,
      rows: this.size.rows,
      cwd: cwd(),
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "vscode" },
    });
    this.pty = proc;
    proc.onData((data) => {
      this.replay = (this.replay + data).slice(-REPLAY_LIMIT);
      this.post({ type: "output", data });
    });
    proc.onExit(({ exitCode }) => {
      if (this.pty !== proc) return;
      this.pty = undefined;
      const data = `\r\n\x1b[2m[OpenCode exited with code ${exitCode}. Press Enter to start it again.]\x1b[0m\r\n`;
      this.replay += data;
      this.post({ type: "output", data });
    });
  }

  restart() {
    const old = this.pty;
    this.pty = undefined;
    if (old) old.kill();
    this.start();
    vscode.commands.executeCommand("opencodeSidebar.view.focus");
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  dispose() {
    if (this.pty) this.pty.kill();
  }

  html(webview) {
    const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...p));
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join("");
    const settings = JSON.stringify(terminalSettings()).replace(/</g, "\\u003c");
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri("node_modules", "@xterm", "xterm", "css", "xterm.css")}">
<link rel="stylesheet" href="${uri("media", "view.css")}">
</head>
<body>
<div id="terminal"></div>
<script nonce="${nonce}">window.OPENCODE_SETTINGS = ${settings};</script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "xterm", "lib", "xterm.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-fit", "lib", "addon-fit.js")}"></script>
<script nonce="${nonce}" src="${uri("node_modules", "@xterm", "addon-webgl", "lib", "addon-webgl.js")}"></script>
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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (WATCHED.some((key) => event.affectsConfiguration(key))) provider.reload();
    }),
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
