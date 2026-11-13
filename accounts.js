// The Claude accounts of dotagents, when it is installed: the current account and its usage in the
// status bar, a click to switch, and the panel (every account) as the view's first tab. Everything
// comes from `dotagents start` on the side the window runs on (in WSL for a WSL window), found
// through <state>/start.json; with none answering, one is started in the background. The rules
// (states, projections, the switch) live in dotagents; this file only shows them.
//
// The functions above startAccounts decide without VS Code, so the tests run them.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The format of what `dotagents start` says (its docs/commands.md); another one is refused.
const API_VERSION = 1;

// The same folder as dotagents' stateDir.
function stateDir(env = process.env, home = os.homedir()) {
  return env.DOTAGENTS_STATE_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "dotagents");
}

// dotagents is set up on this side when it has profiles: then the accounts tab shows.
const hasAccounts = (dir) => fs.existsSync(path.join(dir, "profiles.json"));

// The server's address: { port, token, pid }, or null when there is none to read.
function readServer(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "start.json"), "utf8"));
    return typeof data?.port === "number" && typeof data?.token === "string" && typeof data?.pid === "number" ? data : null;
  } catch {
    return null;
  }
}

// Why an answer can't be used, or "" when it can.
function refusal(json) {
  if (json?.apiVersion === API_VERSION) return json.error ? `dotagents: ${json.error}` : "";
  return typeof json?.apiVersion === "number" && json.apiVersion > API_VERSION
    ? "dotagents is newer than this extension: update dotagents-sidebar."
    : "dotagents is older than this extension: run dotagents update.";
}

const label = (w) => (w.kind === "session" ? "5h" : w.kind === "week" ? "7d" : w.model || "model");

// "5h 79%  7d 38%": the session and the week, two spaces apart (no middle dot, as in the CLI).
function usageText(profile) {
  return profile.windows
    .filter((w) => w.kind !== "model-week")
    .map((w) => `${label(w)} ${w.pct}%`)
    .join("  ");
}

// "3h17m", "4d18h": the time to a reset, short, as in the statusLine.
function shortSpan(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d${h % 24}h`;
}

// The statusLine of the identity (`dotagents usage --short`), in the status bar, as parts with a
// tone each, since a status bar item has one color: the name in the account's color, each window's
// label dimmed, its 8-cell bar (used in ━ in the level's color, the rest in ─ in the track's) and
// its percentage in the level's color, from 70% on with ↻ and the time to the reset.
// personal  5h ━━━━━━── 79% ↻ 3h17m  7d ━━━───── 38%
const level = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok");
// The state's dot, as on the avatars: red needs you, amber asks for attention, green is fine,
// blue is asleep; a ring (limit, waiting) is the other state of the same color.
const DOTS = { error: ["circle-filled", "red"], limit: ["target", "red"], waiting: ["target", "amber"], warn: ["circle-filled", "amber"], ok: ["circle-filled", "green"], asleep: ["circle-filled", "blue"] };
function parts(profile, state, now = Date.now()) {
  const out = [{ text: `$(dotagents-accounts) ${profile.name}`, tone: "name" }];
  const dot = DOTS[state];
  if (dot) out.push({ text: `$(${dot[0]})`, tone: dot[1] });
  for (const w of profile.windows.filter((w) => w.kind !== "model-week")) {
    const used = Math.max(0, Math.min(8, Math.round((w.pct / 100) * 8)));
    const tone = level(w.pct);
    const reset = w.pct >= 70 && w.resetsAt ? ` ↻ ${shortSpan(Date.parse(w.resetsAt) - now)}` : "";
    out.push({ text: label(w), tone: "label" });
    if (used) out.push({ text: "━".repeat(used), tone });
    if (used < 8) out.push({ text: "─".repeat(8 - used), tone: "track" });
    out.push({ text: `${w.pct}%${reset}`, tone });
  }
  return out;
}

// The identity's terminal roles, by the theme's kind; the account's color on a dark theme a third
// of the way to white, as in the panel, or a dark one (#376B80) fades into it.
// The dots keep the avatars' colors on both themes.
const DOT_COLORS = { red: "#ee1d36", amber: "#f58a00", green: "#00b84d", blue: "#2f7bf5" };
const TONES = {
  light: { label: "#4d4d4d", track: "#c9c9c9", ok: "#107d32", warn: "#a25204", high: "#d50322", ...DOT_COLORS },
  dark: { label: "#a0a0a0", track: "#454545", ok: "#01ca54", warn: "#fe9911", high: "#fe6367", ...DOT_COLORS },
};
function toneColor(tone, account, dark) {
  if (tone !== "name") return TONES[dark ? "dark" : "light"][tone];
  if (!dark || !/^#[0-9a-f]{6}$/i.test(account || "")) return account || undefined;
  const mix = (i) => Math.round(parseInt(account.slice(i, i + 2), 16) + (255 - parseInt(account.slice(i, i + 2), 16)) / 3).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

// The status bar: the current account, its state's dot and its usage, in parts. No background:
// it would override the parts' colors, and the dot already says what needs you.
function statusFor(data, now = Date.now()) {
  const current = data.profiles.find((p) => p.name === data.current?.profile) || data.profiles[0];
  if (!current) return { text: "$(dotagents-accounts) dotagents", parts: [{ text: "$(dotagents-accounts) dotagents", tone: "name" }], tooltip: "No profile yet: dotagents profile add <name>" };
  const state = data.current?.profile === current.name ? data.current.state : current.avatar;
  const list = parts(current, state, now);
  const lines = data.profiles.map((p) => {
    const sides = Object.keys(data.slots || {}).filter((s) => data.slots[s] === p.name);
    return `**${p.name}**${sides.length ? ` (${sides.join(", ")})` : ""}  ${usageText(p) || p.state.replace(/-/g, " ")}`;
  });
  return { text: list.map((x) => x.text).join(" "), parts: list, color: current.color, tooltip: lines.join("\n\n") };
}

// The accounts to pick from, the current one marked.
function pickItems(data) {
  return data.profiles.map((p) => {
    const sides = Object.keys(data.slots || {}).filter((s) => data.slots[s] === p.name);
    return {
      label: `${p.name === data.current?.profile ? "$(check) " : ""}${p.name}`,
      profile: p.name,
      description: usageText(p),
      detail: sides.length ? `in the slot on ${sides.join(" and ")}` : p.avatar === "error" ? "no login here" : "",
    };
  });
}

// How to start `dotagents start` on its own. On Windows, `dotagents` is a .cmd, and one started
// from here would be tied to a console window: closing it, or VS Code, stops the server. So a
// hidden PowerShell hands it to Start-Process, which runs it hidden and on its own.
function startCommand(platform) {
  if (platform !== "win32") return ["dotagents", ["start"]];
  return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "Start-Process -WindowStyle Hidden -FilePath dotagents.cmd -ArgumentList start"]];
}

const POLL_MS = 10_000;
const STARTING = "Starting the dotagents server...";

// The accounts in VS Code: the status bar, the switch command, and what the view's accounts tab
// needs: the panel's folder (panelRoot), what the panel is told (message(), and onDidChange when it
// changes) and its actions (act). Null when dotagents isn't set up on this side.
function startAccounts(vscode, context) {
  const { spawn } = require("node:child_process");
  const dir = stateDir();
  if (!hasAccounts(dir)) return null;

  let data = null;
  let down = STARTING;
  let startedAt = 0;
  const listeners = new Set();

  // The running server, asked directly: start.json can outlive its server (a WSL shutdown), so
  // only an answer counts. With none answering, one is started, at most once a minute.
  async function api(method, route, body) {
    const s = readServer(dir);
    try {
      if (!s) throw new Error("no server");
      const res = await fetch(`http://127.0.0.1:${s.port}${route}`, {
        method,
        headers: { "x-dotagents-token": s.token, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(method === "GET" ? 5_000 : 90_000),
      });
      if (res.status === 401 || res.status === 403) throw new Error("not this server");
      return { ok: res.ok, json: await res.json().catch(() => ({})) };
    } catch (err) {
      if (Date.now() - startedAt > 60_000) {
        startedAt = Date.now();
        const [file, args] = startCommand(process.platform);
        const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true });
        child.on("error", () => {});
        child.unref();
      }
      throw new Error(STARTING, { cause: err });
    }
  }

  const message = () => (data ? { type: "usage", data } : { type: "down", detail: down });

  async function act(action, body) {
    let result;
    try {
      const { ok, json } = await api("POST", `/api/${action}`, body || {});
      result = json.apiVersion !== API_VERSION ? { ok: false, detail: refusal(json) } : { ok, detail: json.detail || json.error || "" };
    } catch (err) {
      result = { ok: false, detail: err.message };
    }
    refresh();
    return result;
  }

  // The status bar: one item per part of the status, side by side, since an item has one color.
  // Only the first (the mark and the account) has the tooltip and switches on a click.
  const items = [];
  function showParts(list, color, tooltip) {
    const dark = [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind);
    while (items.length < list.length) {
      const item = vscode.window.createStatusBarItem(`dotagentsSidebar.account.${items.length}`, vscode.StatusBarAlignment.Right, 100 - items.length / 100);
      item.name = "Claude account";
      items.push(item);
    }
    items.forEach((item, n) => {
      const part = list[n];
      if (!part) return item.hide();
      item.text = part.text;
      item.color = toneColor(part.tone, color, dark);
      item.tooltip = n === 0 ? tooltip : undefined;
      item.command = n === 0 ? "dotagentsSidebar.switchAccount" : undefined;
      item.show();
    });
  }
  const showDown = () => showParts([{ text: "$(dotagents-accounts) dotagents", tone: "label" }], undefined, down);

  async function refresh() {
    try {
      const { ok, json } = await api("GET", "/api/usage");
      const why = refusal(json);
      if (!ok || why) throw new Error(why || "no answer");
      data = json;
      const status = statusFor(data);
      const tip = new vscode.MarkdownString(status.tooltip);
      tip.appendMarkdown("\n\n---\n\nClick to switch account");
      showParts(status.parts, status.color, tip);
    } catch (err) {
      data = null;
      down = err.message;
      showDown();
    }
    for (const listener of listeners) listener(message());
  }

  async function switchAccount() {
    if (!data) return vscode.window.showWarningMessage(`dotagents: ${down}`);
    const pick = await vscode.window.showQuickPick(pickItems(data), { placeHolder: "Switch the Claude account, on both sides" });
    if (!pick || pick.profile === data.current?.profile) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `dotagents: switching to ${pick.profile}` }, async () => {
      const result = await act("switch", { profile: pick.profile });
      if (result.ok) vscode.window.showInformationMessage(`dotagents: ${result.detail || `now ${pick.profile}`}. Open conversations go on in the new account when you type continue.`);
      else vscode.window.showErrorMessage(`dotagents: ${result.detail || "the switch failed"}`);
    });
  }

  showDown();
  const timer = setInterval(refresh, POLL_MS);
  context.subscriptions.push(
    { dispose: () => items.forEach((i) => i.dispose()) },
    { dispose: () => clearInterval(timer) },
    vscode.window.onDidChangeActiveColorTheme(() => refresh()),
    vscode.commands.registerCommand("dotagentsSidebar.switchAccount", switchAccount)
  );
  refresh();
  return {
    panelRoot: vscode.Uri.joinPath(context.extensionUri, "media", "accounts"),
    message,
    onDidChange(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    act,
  };
}

module.exports = { API_VERSION, startCommand, stateDir, hasAccounts, readServer, refusal, usageText, statusFor, toneColor, pickItems, startAccounts };
