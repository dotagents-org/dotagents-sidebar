// The agents the view can run, and what is decided about them without VS Code

const crypto = require("crypto");

const PROVIDERS = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    install: "Install it from https://claude.com/claude-code",
    // Claude Code writes its conversation to the normal screen, so the history lives in scrollback
    scrollback: true,
    newline: "\x1b\r", // Alt+Enter
    newConversation: () => crypto.randomUUID(),
    open: (id) => ["--session-id", id],
    resume: (id) => ["--resume", id],
  },
];

// The arguments go through a shell, so only ids made of safe characters get there
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// The arguments that open the agent in a conversation: a new one with the id the view chose,
// or the one it had (resume)
function conversationArgs(provider, id, resume) {
  const args = resume ? provider.resume : provider.open;
  return args && SAFE_ID.test(id || "") ? args(id) : [];
}

function command(provider, platform, args = []) {
  const line = [provider.command, ...args].join(" ");
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoLogo", "-Command", line] };
  }
  // -i loads ~/.bashrc, where the agent's bin folder enters the PATH
  return { file: "bash", args: ["-ic", line] };
}

// Like the integrated terminal, don't hand VS Code's own process variables to the agent:
// ELECTRON_RUN_AS_NODE, for one, breaks any Electron app started from inside it
function env(provider, processEnv) {
  const result = { ...provider.env, ...processEnv, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "vscode" };
  for (const key of Object.keys(result)) {
    if (key.startsWith("ELECTRON_") || (key.startsWith("VSCODE_") && key !== "VSCODE_IPC_HOOK_CLI")) delete result[key];
  }
  return result;
}

function newer(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

module.exports = { PROVIDERS, command, conversationArgs, env, newer };
