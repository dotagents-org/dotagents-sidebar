import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { AGENTS } = require("../agent.js");
const root = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("each agent has a terminal profile, its activation event and its icons", () => {
  const profiles = pkg.contributes.terminal.profiles;
  assert.deepEqual(profiles.map((p) => p.id), ["dotagentsSidebar.profile.claude", "dotagentsSidebar.profile.codex"]);
  for (const profile of profiles) {
    const agent = AGENTS[profile.id.split(".").pop()];
    assert.equal(profile.title, agent.name);
    // VS Code drops a contributed profile whose icon is a path (terminalExtensionPoints.ts), so
    // the menu gets a codicon; the terminal's tab gets the agent's mark from the extension
    assert.match(profile.icon, /^[a-z-]+$/);
    assert.ok(pkg.activationEvents.includes(`onTerminalProfile:${profile.id}`));
  }
  for (const mark of ["claude-code", "codex"]) {
    for (const theme of ["light", "dark"]) assert.ok(fs.existsSync(path.join(root, "media", `${mark}-${theme}.svg`)), `${mark}-${theme}`);
  }
});

test("Codex has its own new and split commands; the new session button stays Claude Code's", () => {
  const commands = pkg.contributes.commands.map((c) => c.command);
  for (const name of ["new", "new.codex", "split", "split.codex"]) assert.ok(commands.includes(`dotagentsSidebar.${name}`), name);
  const buttons = pkg.contributes.menus["view/title"];
  assert.equal(buttons.find((b) => b.group === "navigation@1").command, "dotagentsSidebar.new");
  assert.equal(buttons.filter((b) => b.command === "dotagentsSidebar.new.codex").length, 1);
  assert.equal(new Set(buttons.map((b) => b.group)).size, buttons.length);
});

test("every command the menus use is declared", () => {
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const items of Object.values(pkg.contributes.menus)) {
    for (const item of items) assert.ok(declared.has(item.command), item.command);
  }
});

test("every declared command is registered by the extension", () => {
  const source = ["extension.js", "accounts.js"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  for (const { command } of pkg.contributes.commands) {
    const name = command.replace("dotagentsSidebar.", "");
    assert.ok(source.includes(`"${command}"`) || source.includes(`onSession("${name}"`), command);
  }
});

test("every icon file a command names exists", () => {
  for (const { command, icon } of pkg.contributes.commands) {
    if (!icon || typeof icon === "string") continue;
    for (const file of Object.values(icon)) assert.ok(fs.existsSync(path.join(root, file)), `${command}: ${file}`);
  }
});
