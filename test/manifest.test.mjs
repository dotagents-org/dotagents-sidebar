import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { AGENT } = require("../agent.js");
const root = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("Claude Code has a terminal profile, its activation event and its icons", () => {
  const profiles = pkg.contributes.terminal.profiles;
  assert.equal(profiles.length, 1);
  const [profile] = profiles;
  assert.equal(profile.id, "dotagentsSidebar.profile.claude");
  assert.equal(profile.title, AGENT.name);
  // VS Code drops a contributed profile whose icon is a path (terminalExtensionPoints.ts), so
  // the menu gets a codicon; the terminal's tab gets the agent's mark from the extension
  assert.match(profile.icon, /^[a-z-]+$/);
  assert.ok(pkg.activationEvents.includes("onTerminalProfile:dotagentsSidebar.profile.claude"));
  for (const theme of ["light", "dark"]) assert.ok(fs.existsSync(path.join(root, "media", `claude-${theme}.svg`)), theme);
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
