// The agents the view can run, and what is decided about them without VS Code

const crypto = require("crypto");

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const randomText = (length) => Array.from(crypto.randomBytes(length), (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join("");

const PROVIDERS = [
  {
    id: "opencode",
    name: "OpenCode",
    off: true, // off for now (2026-11-13): only Claude Code is offered
    command: "opencode",
    install: "Install it from https://opencode.ai",
    // OpenCode's "system" theme takes its colors from the terminal, which has the VS Code theme's.
    // Only for the view's process: the user's cli.json is left alone
    env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ theme: { name: "system", mode: "system" } }) },
    // --session creates the session when it does not exist yet, so the same flag opens and resumes
    newConversation: () => `ses_${randomText(26)}`,
    open: (id) => ["--session", id],
    resume: (id) => ["--session", id],
  },
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
  {
    id: "codex",
    name: "Codex",
    off: true, // off for now (2026-11-13): only Claude Code is offered
    command: "codex",
    install: "Install it with npm install -g @openai/codex",
    newline: "\n", // Ctrl+J
    // Codex picks its own id; the view finds it afterwards (findCodexSessions)
    resume: (id) => ["resume", id],
  },
];

// The arguments go through a shell, so only ids made of safe characters get there
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// The arguments that open the agent in a conversation: a new one with the id the view chose,
// or the one it had (resume). An agent that can't do either opens a new conversation of its own
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

// Codex saves each conversation as a rollout with its id, folder and start time. Each session
// gets the first rollout in its folder that started after it and that no other session took
function findCodexSessions(sessions, rollouts, cwd) {
  const free = rollouts.filter((r) => r.cwd === cwd).sort((a, b) => a.started - b.started);
  const found = {};
  for (const session of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const at = free.findIndex((r) => r.started >= session.startedAt);
    if (at < 0) continue;
    found[session.id] = free[at].id;
    free.splice(0, at + 1);
  }
  return found;
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

// Every agent the view knows (ALL_PROVIDERS) and the ones it offers (PROVIDERS): one switched off
// keeps its definition, so turning it back on is taking its off: true away and restoring its
// entries in package.json.
const ALL_PROVIDERS = PROVIDERS;
module.exports = { ALL_PROVIDERS, PROVIDERS: PROVIDERS.filter((p) => !p.off), command, conversationArgs, env, findCodexSessions, newer };
