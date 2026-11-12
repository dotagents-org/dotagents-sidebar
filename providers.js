// The agents the view can run, and what is decided about them without VS Code

const PROVIDERS = [
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    install: "Install it from https://opencode.ai",
    // OpenCode's "system" theme takes its colors from the terminal, which has the VS Code theme's.
    // Only for the view's process: the user's cli.json is left alone
    env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify({ theme: { name: "system", mode: "system" } }) },
  },
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    install: "Install it from https://claude.com/claude-code",
    // Claude Code writes its conversation to the normal screen, so the history lives in scrollback
    scrollback: true,
    newline: "\x1b\r", // Alt+Enter
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    install: "Install it with npm install -g @openai/codex",
    newline: "\n", // Ctrl+J
  },
];

function command(provider, platform) {
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoLogo", "-Command", provider.command] };
  }
  // -i loads ~/.bashrc, where the agent's bin folder enters the PATH
  return { file: "bash", args: ["-ic", provider.command] };
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

module.exports = { PROVIDERS, command, env, newer };
