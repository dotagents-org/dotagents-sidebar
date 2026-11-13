import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it: what accounts.js decides without VS Code
const accounts = createRequire(import.meta.url)("../accounts.js");

const data = {
  current: { profile: "personal", state: "warn" },
  slots: { WSL: "personal", Windows: "work" },
  profiles: [
    { name: "personal", state: "ok", avatar: "warn", windows: [{ kind: "session", pct: 79, resetsAt: "2026-11-12T15:17:00Z" }, { kind: "week", pct: 38 }, { kind: "model-week", model: "Opus", pct: 13 }] },
    { name: "work", state: "ok", avatar: "ok", windows: [{ kind: "session", pct: 0 }, { kind: "week", pct: 11 }] },
  ],
};

test("the accounts show where dotagents has profiles, and the server is found where dotagents start leaves it", () => {
  assert.equal(accounts.stateDir({ DOTAGENTS_STATE_DIR: "/state" }, "/home/me"), "/state");
  assert.equal(accounts.stateDir({}, "/home/me"), path.join("/home/me", ".config", "dotagents"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-sidebar-accounts-"));
  try {
    assert.equal(accounts.hasAccounts(dir), false);
    fs.writeFileSync(path.join(dir, "profiles.json"), JSON.stringify({ version: 1, profiles: [] }));
    assert.equal(accounts.hasAccounts(dir), true);
    assert.equal(accounts.readServer(dir), null);
    fs.writeFileSync(path.join(dir, "start.json"), JSON.stringify({ port: 7337, token: "t", pid: 1 }));
    assert.deepEqual(accounts.readServer(dir), { port: 7337, token: "t", pid: 1 });
    fs.writeFileSync(path.join(dir, "start.json"), "{not json");
    assert.equal(accounts.readServer(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an answer in another API version is refused with what to update, and an error is passed on", () => {
  assert.equal(accounts.refusal({ apiVersion: 1, profiles: [] }), "");
  assert.equal(accounts.refusal({ apiVersion: 1, error: "profiles.json is not valid JSON" }), "dotagents: profiles.json is not valid JSON");
  assert.match(accounts.refusal({ apiVersion: 2 }), /update dotagents-sidebar/);
  assert.match(accounts.refusal({ version: 1, profiles: [] }), /run dotagents update/, "a server from before the API had a version");
});

test("the status bar shows the current account and its windows as in the statusLine, in parts with a tone each", () => {
  const status = accounts.statusFor(data, Date.parse("2026-11-12T12:00:00Z"));
  assert.deepEqual(status.parts, [
    { text: "$(dotagents-accounts) personal", tone: "name" },
    { text: "$(circle-filled)", tone: "amber" },
    { text: "5h", tone: "label" },
    { text: "━━━━━━", tone: "warn" },
    { text: "──", tone: "track" },
    { text: "79% ↻ 3h17m", tone: "warn" },
    { text: "7d", tone: "label" },
    { text: "━━━", tone: "ok" },
    { text: "─────", tone: "track" },
    { text: "38%", tone: "ok" },
  ]);
  assert.match(status.tooltip, /\*\*work\*\* \(Windows\)  5h 0%  7d 11%/);
  assert.doesNotMatch(status.text, /·/, "no middle dot");
});

test("the status bar shows the state as the avatars' dot: its color, and a ring for limit and waiting", () => {
  const dot = (state) => accounts.statusFor({ ...data, current: { profile: "personal", state } }).parts[1];
  assert.deepEqual(dot("error"), { text: "$(circle-filled)", tone: "red" });
  assert.deepEqual(dot("limit"), { text: "$(target)", tone: "red" });
  assert.deepEqual(dot("waiting"), { text: "$(target)", tone: "amber" });
  assert.deepEqual(dot("ok"), { text: "$(circle-filled)", tone: "green" });
  assert.deepEqual(dot("asleep"), { text: "$(circle-filled)", tone: "blue" });
});

test("the status bar's colors are the identity's terminal roles, the account's lighter on a dark theme", () => {
  assert.equal(accounts.toneColor("high", "#D77655", false), "#d50322");
  assert.equal(accounts.toneColor("track", "#D77655", true), "#454545");
  assert.equal(accounts.toneColor("name", "#376B80", false), "#376B80");
  assert.equal(accounts.toneColor("name", "#376B80", true), "#7a9caa");
});

test("the switch lists every account with its usage and where it is, the current one marked", () => {
  const items = accounts.pickItems(data);
  assert.deepEqual(items.map((i) => i.label), ["$(check) personal", "work"]);
  assert.equal(items[1].detail, "in the slot on Windows");
  assert.equal(items[1].profile, "work");
});

test("dotagents start runs on its own: directly on Linux and macOS, through a hidden Start-Process on Windows", () => {
  assert.deepEqual(accounts.startCommand("linux"), ["dotagents", ["start"]]);
  assert.deepEqual(accounts.startCommand("darwin"), ["dotagents", ["start"]]);
  const [file, args] = accounts.startCommand("win32");
  assert.equal(file, "powershell.exe");
  assert.ok(args.includes("Hidden"));
  assert.match(args.at(-1), /^Start-Process -WindowStyle Hidden -FilePath dotagents\.cmd -ArgumentList start$/);
});
