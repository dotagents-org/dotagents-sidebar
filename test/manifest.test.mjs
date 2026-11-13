import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { PROVIDERS } = require("../providers.js");
const root = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("every agent has a terminal profile, its activation event and its icons", () => {
  const profiles = pkg.contributes.terminal.profiles;
  for (const p of PROVIDERS) {
    const profile = profiles.find((x) => x.id === `dotagentsSidebar.profile.${p.id}`);
    assert.ok(profile, `profile for ${p.id}`);
    assert.equal(profile.title, p.name);
    // VS Code drops a contributed profile whose icon is a path (terminalExtensionPoints.ts), so
    // the menu gets a codicon; the terminal's tab gets the agent's mark from the extension
    assert.match(profile.icon, /^[a-z-]+$/, `codicon for ${p.id}`);
    assert.ok(pkg.activationEvents.includes(`onTerminalProfile:dotagentsSidebar.profile.${p.id}`), `activation for ${p.id}`);
    for (const theme of ["light", "dark"]) assert.ok(fs.existsSync(path.join(root, "media", `${p.id}-${theme}.svg`)), `${p.id}-${theme}`);
  }
  assert.equal(profiles.length, PROVIDERS.length);
});

test("every command and submenu the menus use is declared", () => {
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  const submenus = new Set(pkg.contributes.submenus.map((m) => m.id));
  for (const items of Object.values(pkg.contributes.menus)) {
    for (const item of items) {
      if (item.submenu) assert.ok(submenus.has(item.submenu), item.submenu);
      else assert.ok(declared.has(item.command), item.command);
    }
  }
  for (const id of submenus) assert.ok(pkg.contributes.menus[id]?.length, `items of ${id}`);
});

test("the + menu opens or splits a session with each agent, like the terminal panel's", () => {
  const menu = (id) => pkg.contributes.menus[id].map((item) => item.command || item.submenu);
  for (const p of PROVIDERS) {
    assert.ok(menu("dotagentsSidebar.newMenu").includes(`dotagentsSidebar.new.${p.id}`), p.id);
    assert.ok(menu("dotagentsSidebar.splitMenu").includes(`dotagentsSidebar.split.${p.id}`), p.id);
  }
  assert.ok(menu("dotagentsSidebar.newMenu").includes("dotagentsSidebar.splitMenu"));
});

test("every declared command is registered by the extension", () => {
  const source = ["extension.js", "accounts.js"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  for (const { command } of pkg.contributes.commands) {
    const name = command.replace("dotagentsSidebar.", "");
    const perAgent = /^(new|split)\.(\w+)$/.exec(name);
    if (perAgent) {
      assert.ok(PROVIDERS.some((p) => p.id === perAgent[2]), command);
      assert.ok(source.includes(`\`dotagentsSidebar.${perAgent[1]}.\${provider.id}\``), command);
    } else assert.ok(source.includes(`"${command}"`) || source.includes(`onSession("${name}"`), command);
  }
});
