// The agent the view runs, Claude Code, and what is decided about it without VS Code

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

// The agents a session can run. A session says which in its "provider" field; one saved before
// Codex had none, and is Claude Code
const AGENTS = {
  claude: {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    install: "Install it from https://claude.com/claude-code",
    newline: "\x1b\r", // Alt+Enter
  },
  codex: {
    id: "codex",
    name: "Codex",
    command: "codex",
    install: "Install it with npm install -g @openai/codex",
    newline: "\n", // Ctrl+J
  },
};

const agentOf = (session) => (session && session.provider === "codex" ? AGENTS.codex : AGENTS.claude);

// A new conversation gets an id the view chooses, so the session can resume it later
const newConversation = () => crypto.randomUUID();

// The arguments go through a shell, so only ids made of safe characters get there
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// The arguments that open an agent in a conversation. Claude Code: a new one with the id the view
// chose, or the one it had (resume). Codex picks its own id, so a new one takes no arguments and
// the view finds the id afterwards (findCodexSessions)
function conversationArgs(agent, id, resume) {
  if (!SAFE_ID.test(id || "")) return [];
  if (agent.id === "codex") return resume ? ["resume", id] : [];
  return [resume ? "--resume" : "--session-id", id];
}

function command(platform, agent, args = []) {
  const line = [agent.command, ...args].join(" ");
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoLogo", "-Command", line] };
  }
  // -i loads ~/.bashrc, where the agent's bin folder enters the PATH
  return { file: "bash", args: ["-ic", line] };
}

// Codex saves each conversation as $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, whose
// first line holds the conversation's id, folder and start time (the day folders use local time)
const codexHome = (processEnv = process.env) => processEnv.CODEX_HOME || path.join(os.homedir(), ".codex");

const HEAD_LIMIT = 262144;

function readFirstLine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(8192);
    for (let total = 0; total < HEAD_LIMIT; ) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, total);
      if (!n) break;
      total += n;
      const end = buffer.subarray(0, n).indexOf(10);
      chunks.push(Buffer.from(buffer.subarray(0, end < 0 ? n : end)));
      if (end >= 0) break;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// The rollouts modified since a time, as { id, cwd, started }. A file that can't be read or isn't
// a conversation's is skipped
function readRollouts(home, since) {
  const found = [];
  const list = (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  };
  // The day folders from the day before `since` (a session started near midnight) to today
  const first = new Date(since);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - 1);
  const last = new Date();
  for (let day = first; day <= last; day.setDate(day.getDate() + 1)) {
    const dir = path.join(home, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
    for (const name of list(dir)) {
      if (!/^rollout-.*\.jsonl$/.test(name)) continue;
      try {
        const file = path.join(dir, name);
        if (fs.statSync(file).mtimeMs < since) continue;
        const meta = JSON.parse(readFirstLine(file));
        const { id, cwd, timestamp } = (meta.type === "session_meta" && meta.payload) || {};
        const started = Date.parse(timestamp);
        if (SAFE_ID.test(id || "") && typeof cwd === "string" && started) found.push({ id, cwd, started });
      } catch {
        // unreadable or not a rollout
      }
    }
  }
  return found;
}

// Each Codex session still without a conversation ({ id, cwd, startedAt }) gets the first rollout
// in its folder that started after it and that no other session took: { session id: conversation id }
function findCodexSessions(pending, rollouts) {
  const free = [...rollouts].sort((a, b) => a.started - b.started);
  const found = {};
  for (const session of [...pending].sort((a, b) => a.startedAt - b.startedAt)) {
    const at = free.findIndex((r) => r.cwd === session.cwd && r.started >= session.startedAt);
    if (at < 0) continue;
    found[session.id] = free[at].id;
    free.splice(at, 1);
  }
  return found;
}

// The user's shell, run as a terminal session: a login-less interactive one, like the integrated terminal's default
const TERMINAL = { name: "Terminal" };

// Bash and PowerShell also report the folder they are in at each prompt (media/cwd.js reads it)
const POWERSHELL_CWD =
  "$global:__dotagentsPrompt = $function:prompt; function global:prompt { " +
  "if ($PWD.Provider.Name -eq 'FileSystem') { [Console]::Write([char]27 + ']9;9;' + $PWD.ProviderPath + [char]7) }; & $global:__dotagentsPrompt }";

function terminalCommand(platform, processEnv = {}, root = __dirname) {
  if (platform === "win32") return { file: "powershell.exe", args: ["-NoLogo", "-NoExit", "-Command", POWERSHELL_CWD] };
  const file = processEnv.SHELL || "bash";
  if (path.basename(file) === "bash") return { file, args: ["--rcfile", path.join(root, "shell", "bash-cwd.sh"), "-i"] };
  return { file, args: ["-i"] };
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

module.exports = { AGENTS, agentOf, TERMINAL, terminalCommand, newConversation, command, conversationArgs, codexHome, readRollouts, findCodexSessions, env, newer };
