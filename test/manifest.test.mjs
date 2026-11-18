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

test("the title strip opens Claude Code, Codex or a terminal, each from its own button with its mark", () => {
  const commands = pkg.contributes.commands.map((c) => c.command);
  for (const name of ["new", "new.codex", "split"]) assert.ok(commands.includes(`dotagentsSidebar.${name}`), name);
  // The view draws the buttons in its own strip (extension.js, TITLE_BUTTONS), so VS Code's title bar has none
  assert.equal(pkg.contributes.menus["view/title"], undefined);
  const source = fs.readFileSync(path.join(root, "extension.js"), "utf8");
  const buttons = JSON.parse(source.match(/const TITLE_BUTTONS = (\[.*\]);/)[1]);
  assert.deepEqual(buttons.slice(0, 3), ["dotagentsSidebar.new", "dotagentsSidebar.new.codex", "dotagentsSidebar.newTerminal"]);
  for (const name of buttons) assert.ok(pkg.contributes.commands.find((c) => c.command === name)?.icon?.dark, name);
  const icon = (name) => pkg.contributes.commands.find((c) => c.command === name).icon.dark;
  assert.equal(icon("dotagentsSidebar.new"), "media/claude-code-dark.svg");
  assert.equal(icon("dotagentsSidebar.new.codex"), "media/codex-dark.svg");
  assert.equal(pkg.contributes.submenus, undefined, "no + or ⌄ menu");
  // Titles without the prefix; the palette adds the category.
  for (const c of pkg.contributes.commands) assert.equal(c.category, "dotagents-sidebar", c.command);
});

test("every command and submenu the menus use is declared", () => {
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  const submenus = new Set((pkg.contributes.submenus || []).map((s) => s.id));
  for (const items of Object.values(pkg.contributes.menus)) {
    for (const item of items) assert.ok(item.submenu ? submenus.has(item.submenu) : declared.has(item.command), item.submenu || item.command);
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
