// The agent the view runs, Claude Code, and what is decided about it without VS Code

const crypto = require("crypto");

const AGENT = {
  name: "Claude Code",
  command: "claude",
  install: "Install it from https://claude.com/claude-code",
  newline: "\x1b\r", // Alt+Enter
};

// A new conversation gets an id the view chooses, so the session can resume it later
const newConversation = () => crypto.randomUUID();

// The arguments go through a shell, so only ids made of safe characters get there
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// The arguments that open Claude Code in a conversation: a new one with the id the view chose,
// or the one it had (resume)
function conversationArgs(id, resume) {
  return SAFE_ID.test(id || "") ? [resume ? "--resume" : "--session-id", id] : [];
}

function command(platform, args = []) {
  const line = [AGENT.command, ...args].join(" ");
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoLogo", "-Command", line] };
  }
  // -i loads ~/.bashrc, where the agent's bin folder enters the PATH
  return { file: "bash", args: ["-ic", line] };
}

// Like the integrated terminal, don't hand VS Code's own process variables to the agent:
// ELECTRON_RUN_AS_NODE, for one, breaks any Electron app started from inside it
function env(processEnv) {
  const result = { ...processEnv, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "vscode" };
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

module.exports = { AGENT, newConversation, command, conversationArgs, env, newer };
