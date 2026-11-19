import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// The same file the view loads as a script
const { codex, strip } = createRequire(import.meta.url)("../../webview/terminals/title.js");

test("a Codex title keeps the thread's name and drops the project, in any order and cut as Codex cuts it", () => {
  assert.equal(codex("⠋ fix login | shop", "shop"), "fix login"); // the default order
  assert.equal(codex("shop | fix login", "shop"), "fix login"); // tui.terminal_title = ["project-name", "thread-title"]
  assert.equal(codex("a-very-long-workspace...", "a-very-long-workspace-name-here"), "a-very-long-workspace...");
  assert.equal(codex("a-very-long-workspace... | fix login", "a-very-long-workspace-name-here"), "fix login");
  assert.equal(codex("fix login | elsewhere", "shop"), "fix login"); // the project from another folder: the last part, by default
  assert.equal(codex("✳ fix login", "shop"), "fix login");
  assert.equal(strip("✳ fix login"), "fix login");
});
