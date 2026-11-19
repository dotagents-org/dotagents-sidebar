// The session agents and their launch commands, independent of VS Code

const crypto = require("crypto");
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

// An argument goes into the shell line as is when it is plain, else in single quotes, which
// neither bash nor PowerShell expands
function quote(platform, arg) {
  if (/^[A-Za-z0-9_\-.,:=@+/]+$/.test(arg)) return arg;
  return platform === "win32" ? `'${arg.replace(/'/g, "''")}'` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function command(platform, agent, args = []) {
  const rest = args.map((arg) => quote(platform, arg));
  if (platform === "win32") {
    // Only an application (.exe, .cmd): npm puts a codex.ps1 beside codex.cmd, and PowerShell, which
    // would pick the .ps1, refuses it where scripts are blocked
    const line = [`& (Get-Command ${agent.command} -CommandType Application -ErrorAction Stop)[0].Source`, ...rest].join(" ");
    return { file: "powershell.exe", args: ["-NoLogo", "-Command", line] };
  }
  const line = [agent.command, ...rest].join(" ");
  // -i loads ~/.bashrc, where the agent's bin folder enters the PATH
  return { file: "bash", args: ["-ic", line] };
}

// The user's shell, run as a terminal session: a login-less interactive one, like the integrated terminal's default
const TERMINAL = { name: "Terminal" };

// Bash and PowerShell also report the folder they are in at each prompt (webview/terminals/cwd.js reads it)
const POWERSHELL_CWD =
  "$global:__dotagentsPrompt = $function:prompt; function global:prompt { " +
  "if ($PWD.Provider.Name -eq 'FileSystem') { [Console]::Write([char]27 + ']9;9;' + $PWD.ProviderPath + [char]7) }; & $global:__dotagentsPrompt }";

function terminalCommand(platform, processEnv = {}, root = path.join(__dirname, "..", "..")) {
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


module.exports = { AGENTS, agentOf, TERMINAL, terminalCommand, newConversation, quote, command, conversationArgs, env };
