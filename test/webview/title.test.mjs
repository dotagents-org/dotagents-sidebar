import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// The same file the view loads as a script
const { codex, strip } = createRequire(import.meta.url)("../../webview/terminals/title.js");

test("a Codex title keeps the thread's name and drops the project, in any order and cut as Codex cuts it", () => {
  assert.equal(codex("⠋ fix login | shop", ["shop"]), "fix login"); // the default order
  assert.equal(codex("shop | fix login", ["shop"]), "fix login"); // tui.terminal_title = ["project-name", "thread-title"]
  assert.equal(codex("a-very-long-workspace...", ["a-very-long-workspace-name-here"]), "a-very-long-workspace...");
  assert.equal(codex("a-very-long-workspace... | fix login", ["a-very-long-workspace-name-here"]), "fix login");
  // The folder Codex runs in, when the window has another name
  assert.equal(codex("repo | fix login", ["repo", "repo-workspace"]), "fix login");
  assert.equal(codex("repo | fix login", [undefined, "repo-workspace"]), "repo | fix login"); // unknown: whole, never the thread's name lost
  assert.equal(codex("✳ fix login", ["shop"]), "fix login");
  assert.equal(codex("repo | repo", ["repo"]), "repo | repo"); // a thread named as its project: both stay
  // 24 graphemes, not code points: "é" written as e and its accent counts once
  const accented = "proje\u0301to-com-um-nome-longo-demais";
  assert.equal(codex(`proje\u0301to-com-um-nome-l... | fix login`, [accented]), "fix login");
  assert.equal(strip("✳ fix login"), "fix login");
});
