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
    const profile = profiles.find((x) => x.id === `agentsSidebar.profile.${p.id}`);
    assert.ok(profile, `profile for ${p.id}`);
    assert.equal(profile.title, p.name);
    assert.deepEqual(profile.icon, { light: `media/${p.id}-light.svg`, dark: `media/${p.id}-dark.svg` });
    assert.ok(pkg.activationEvents.includes(`onTerminalProfile:agentsSidebar.profile.${p.id}`), `activation for ${p.id}`);
    for (const file of Object.values(profile.icon)) assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.equal(profiles.length, PROVIDERS.length);
});

test("every command the menus use is declared", () => {
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const items of Object.values(pkg.contributes.menus)) {
    for (const item of items) assert.ok(declared.has(item.command), item.command);
  }
});

test("every declared command is registered by the extension", () => {
  const source = fs.readFileSync(path.join(root, "extension.js"), "utf8");
  for (const { command } of pkg.contributes.commands) {
    const name = command.replace("agentsSidebar.", "");
    assert.ok(source.includes(`"${command}"`) || source.includes(`onSession("${name}"`), command);
  }
});
