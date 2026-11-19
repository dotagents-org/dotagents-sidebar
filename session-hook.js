// Which conversation an agent session is in, told by the agent itself. Each agent the view opens
// gets a SessionStart hook on its own command line, never in the user's settings: Claude Code and
// Codex run it when a conversation starts, resumes, is cleared (/clear) or forked, with the
// conversation's id on stdin, and it writes that to the file named in DOTAGENTS_SESSION_FILE, one
// per session. An agent started anywhere else has no such variable, so there the hook does nothing.
// The view reads the file before it resumes a session (Claude Code after /clear or /resume, and
// Codex, which picks its own ids)

const fs = require("fs");

const VARIABLE = "DOTAGENTS_SESSION_FILE";
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// The hook's command. Both always exit 0, so a failure never gets in the agent's way. PowerShell
// started with -Command hands its stdin to $input (Codex runs hooks that way), else it is the
// console's, read in UTF-8 rather than the console's code page. No quotes in it: see codexOverride
const POSIX = `[ -z "$${VARIABLE}" ] || cat > "$${VARIABLE}"; exit 0`;
const POWERSHELL =
  `try { if ($env:${VARIABLE}) { [Console]::InputEncoding = [Text.Encoding]::UTF8; $text = @($input) -join [char]10; ` +
  `if (-not $text) { $text = [Console]::In.ReadToEnd() }; [IO.File]::WriteAllText($env:${VARIABLE}, $text) } } catch {}; exit 0`;

// Claude Code adds the settings of a --settings file to the user's. On Windows the hook runs in
// PowerShell, since Git Bash may be missing
function claudeSettings(platform) {
  const hook = platform === "win32" ? { type: "command", shell: "powershell", command: POWERSHELL } : { type: "command", command: POSIX };
  return { hooks: { SessionStart: [{ hooks: [hook] }] } };
}

// Codex takes it as a config override (-c), added to the user's hooks. On Windows it runs hooks in
// PowerShell, and the strings are TOML literal strings: PowerShell 5.1 loses the double quotes
// inside an argument it passes on. Codex runs a hook only once the user trusts it (it asks once,
// and remembers the command); until then the view falls back on the rollouts (codex-sessions.js)
function codexOverride(platform) {
  const string = platform === "win32" ? (s) => `'${s}'` : JSON.stringify;
  const command = platform === "win32" ? POWERSHELL : POSIX;
  return `hooks.SessionStart=[{hooks=[{type=${string("command")},command=${string(command)}}]}]`;
}

// The arguments that give an agent the hook; settingsFile holds claudeSettings
function args(platform, agent, settingsFile) {
  return agent.id === "codex" ? ["-c", codexOverride(platform)] : ["--settings", settingsFile];
}

// What the agent last told: { conversation, transcript, source }, or undefined when it told nothing
// yet or the file can't be read
function read(file) {
  try {
    const told = JSON.parse(fs.readFileSync(file, "utf8"));
    if (SAFE_ID.test(told.session_id || "")) return { conversation: told.session_id, transcript: told.transcript_path || undefined, source: told.source };
  } catch {
    // not there yet, or half written
  }
  return undefined;
}

function forget(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // already gone
  }
}

module.exports = { VARIABLE, POSIX, POWERSHELL, claudeSettings, codexOverride, args, read, forget };
