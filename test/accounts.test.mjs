import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Plain CommonJS, loaded as VS Code loads it: what accounts.js decides without VS Code
const accounts = createRequire(import.meta.url)("../accounts.js");

// One provider, an API 2 answer: what the sidebar showed before Codex.
const data = {
  current: { claude: { profile: "personal", state: "warn" } },
  slots: { claude: { WSL: "personal", Windows: "work" } },
  profiles: [
    { name: "personal", provider: "claude", state: "ok", avatar: "warn", windows: [{ kind: "session", pct: 79, resetsAt: "2026-11-12T15:17:00Z" }, { kind: "week", pct: 38 }, { kind: "model-week", model: "Opus", pct: 13 }] },
    { name: "work", provider: "claude", state: "ok", avatar: "ok", windows: [{ kind: "session", pct: 0 }, { kind: "week", pct: 11 }] },
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
  assert.equal(accounts.refusal({ apiVersion: 2, profiles: [] }), "");
  assert.match(accounts.refusal({ apiVersion: 1, profiles: [] }), /run dotagents update/, "version 1 is from before the providers");
  assert.equal(accounts.refusal({ apiVersion: 2, error: "profiles.json is not valid JSON" }), "dotagents: profiles.json is not valid JSON");
  assert.match(accounts.refusal({ apiVersion: 3 }), /update dotagents-sidebar/);
  assert.match(accounts.refusal({ version: 1, profiles: [] }), /run dotagents update/, "a server from before the API had a version");
});

test("the status bar shows the current account and its windows as in the statusLine, in parts with a tone each", () => {
  const groups = accounts.groupsFor(data, Date.parse("2026-11-12T12:00:00Z"));
  assert.equal(groups.length, 1, "one provider, one group");
  const status = groups[0];
  assert.deepEqual(status.parts, [
    { text: "$(dotagents-claude) personal", tone: "name" },
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
  const dot = (state) => accounts.groupsFor({ ...data, current: { claude: { profile: "personal", state } } })[0].parts[1];
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
  assert.equal(items[0].description, "Claude  5h 79%  7d 38%");
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

// Two providers, an API 2 answer: Claude's pair and a ChatGPT seat in one slot.
const both = {
  ...data,
  current: { claude: data.current.claude, codex: { profile: "hopper", state: "asleep" } },
  slots: { claude: data.slots.claude, codex: { WSL: "hopper" } },
  profiles: [
    ...data.profiles,
    { name: "hopper", provider: "codex", plan: "team", color: "#7B61A8", state: "ok", avatar: "ok", windows: [{ kind: "session", pct: 40 }, { kind: "week", pct: 95 }] },
    { name: "dijkstra", provider: "codex", plan: "team", color: "#B8862B", state: "no-data", avatar: "asleep", windows: [] },
  ],
};

test("with a ChatGPT account the status bar has a second group, led by the OpenAI mark and reading the codex current", () => {
  const [claude, codex] = accounts.groupsFor(both, Date.parse("2026-11-12T12:00:00Z"));
  assert.equal(claude.parts[0].text, "$(dotagents-claude) personal");
  assert.equal(codex.parts[0].text, "$(dotagents-openai) hopper");
  assert.deepEqual(codex.parts[1], { text: "$(circle-filled)", tone: "blue" }, "the dot is the ChatGPT current's state");
  assert.equal(codex.color, "#7B61A8");
  assert.match(codex.tooltip, /\*\*hopper\*\* \(WSL\)  5h 40%  7d 95%/);
  assert.match(codex.tooltip, /\*\*dijkstra\*\*  no data/);
  assert.doesNotMatch(codex.tooltip, /personal/, "each group lists its own provider's accounts");
  assert.doesNotMatch(claude.tooltip, /hopper/);
});

test("a ChatGPT profile without a codex current falls back to the first one, and with none there is no ChatGPT group", () => {
  const { current, ...rest } = both;
  const [, codex] = accounts.groupsFor({ ...rest, current: { claude: current.claude } });
  assert.equal(codex.parts[0].text, "$(dotagents-openai) hopper");
  assert.equal(accounts.groupsFor(data).length, 1);
});

test("with no Claude profile the first group is the brand, and the ChatGPT one still shows", () => {
  const onlyCodex = { ...both, profiles: both.profiles.filter((p) => p.provider === "codex"), current: { claude: { profile: "dotagents", state: "asleep" }, codex: both.current.codex } };
  const [brand, codex] = accounts.groupsFor(onlyCodex);
  assert.equal(brand.parts[0].text, "$(dotagents-accounts) dotagents");
  assert.equal(codex.parts[0].text, "$(dotagents-openai) hopper");
});

test("the switch lists both providers' accounts, Claude first, the provider named and each current one marked", () => {
  const items = accounts.pickItems(both);
  assert.deepEqual(items.map((i) => [i.label, i.provider]), [["$(check) personal", "claude"], ["work", "claude"], ["$(check) hopper", "codex"], ["dijkstra", "codex"]]);
  assert.equal(items[2].description, "ChatGPT  5h 40%  7d 95%");
  assert.equal(items[2].detail, "in the slot on WSL");
  assert.equal(items[3].description, "ChatGPT");
  assert.equal(items[3].profile, "dijkstra", "the switch posts the profile, whichever the provider");
});

test("a marked account can be switched until it is in every slot of its provider", () => {
  const sides = ["WSL", "Windows"];
  const slots = { ...both.slots, codex: { WSL: "hopper", Windows: "dijkstra" } };
  const snapshot = { ...both, sides, slots };
  const [claude, , codex] = accounts.pickItems(snapshot);
  assert.equal(accounts.inEverySlot(snapshot, claude), false);
  assert.equal(accounts.inEverySlot(snapshot, codex), false);
  assert.equal(accounts.inEverySlot({ ...snapshot, slots: { ...slots, codex: { WSL: "hopper", Windows: "hopper" } } }, codex), true);
  const peerOff = { ...snapshot, slots: both.slots, peer: { name: "Windows", up: false } };
  assert.equal(accounts.inEverySlot(peerOff, codex), false, "the offline side's slot is unknown");
  assert.equal(accounts.inEverySlot({ ...both, sides: ["WSL"] }, codex), true, "a standalone machine has one slot");
});

test("a provider's view takes its profiles, its slots and its current from an API 2 answer", () => {
  const codex = accounts.forProvider(both, "codex");
  assert.deepEqual(codex.profiles.map((p) => p.name), ["hopper", "dijkstra"]);
  assert.deepEqual(codex.slots, { WSL: "hopper" });
  assert.equal(codex.current.profile, "hopper");
  assert.deepEqual(accounts.forProvider(both, "claude").slots, data.slots.claude);
  assert.deepEqual(accounts.forProvider({ ...data, slots: undefined }, "codex").slots, {});
});

// What the sidebar shows of the table comes from providers.js, whatever the API's profiles say.
const withUnknown = { ...both, profiles: [...both.profiles, { name: "ghost", provider: "gemini", state: "ok", avatar: "ok", windows: [{ kind: "session", pct: 1 }] }] };

test("both providers: the panel is told each one's name, tool and mark, and the status bar and the pick list use the same table", () => {
  const table = accounts.panelProviders;
  assert.deepEqual(Object.keys(table), ["claude", "codex"], "Claude first");
  assert.deepEqual([table.claude.title, table.claude.agent, table.codex.title, table.codex.agent], ["Claude", "Claude Code", "ChatGPT", "Codex"]);
  assert.notEqual(table.claude.mark, table.codex.mark);
  assert.ok(table.claude.mark && table.codex.mark);
  assert.equal(accounts.groupsFor(both).length, 2);
  assert.equal(accounts.pickItems(both).find((i) => i.provider === "codex").description.split("  ")[0], "ChatGPT");
});

test("Claude only: with no ChatGPT profile there is no ChatGPT group in the status bar nor in the pick list", () => {
  const claudeOnly = { ...both, profiles: both.profiles.filter((p) => p.provider === "claude") };
  assert.equal(accounts.groupsFor(claudeOnly).length, 1);
  assert.deepEqual(accounts.pickItems(claudeOnly).map((i) => i.provider), ["claude", "claude"]);
  assert.equal(accounts.known(claudeOnly).profiles.length, 2);
});

test("an unknown provider id is skipped: no group, no pick item, and not in what the panel gets", () => {
  assert.equal(accounts.groupsFor(withUnknown).length, 2);
  assert.ok(!accounts.pickItems(withUnknown).some((i) => i.profile === "ghost"));
  assert.deepEqual(accounts.known(withUnknown).profiles.map((p) => p.name), ["personal", "work", "hopper", "dijkstra"]);
  assert.deepEqual(accounts.groupsFor({ ...data, profiles: [{ ...data.profiles[0], provider: "gemini" }] })[0].parts[0].text, "$(dotagents-accounts) dotagents", "only unknown profiles leave Claude's brand group");
});
