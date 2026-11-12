import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { parseJsonc, normalize, eventCombo, skipCommands, keysForVsCode, FALLBACK } = require("../media/keys.js");
const SKIP = require("../skip-shell.json");

test("the copied skip list is VS Code's, with the commands that matter here", () => {
  assert.ok(SKIP.commands.length > 100);
  for (const c of ["workbench.action.quickOpen", "workbench.action.showCommands", "workbench.action.togglePanel"]) assert.ok(SKIP.commands.includes(c), c);
});

test("parseJsonc reads VS Code's keybindings files: comments and trailing commas", () => {
  const text = `// Place your key bindings in this file
[
  { "key": "ctrl+p", "command": "workbench.action.quickOpen" }, // quick open
  /* block */ { "key": "ctrl+k ctrl+s", "command": "workbench.action.openGlobalKeybindings", "when": "a // b" },
]`;
  assert.deepEqual(parseJsonc(text), [
    { key: "ctrl+p", command: "workbench.action.quickOpen" },
    { key: "ctrl+k ctrl+s", command: "workbench.action.openGlobalKeybindings", when: "a // b" },
  ]);
  assert.equal(parseJsonc("not json"), undefined);
});

test("normalize puts one key of a binding in a single form", () => {
  assert.equal(normalize("Shift+Ctrl+P"), "ctrl+shift+p");
  assert.equal(normalize("cmd+alt+up"), "alt+meta+up");
  assert.equal(normalize("ctrl+[Backquote]"), "ctrl+`");
  assert.equal(normalize("ctrl+[KeyE]"), "ctrl+e");
  assert.equal(normalize("ctrl+[Nope]"), null);
  assert.equal(normalize("f1"), "f1");
  assert.equal(normalize("ctrl+"), null);
});

test("eventCombo names a key press the way the bindings do, whatever the keyboard layout", () => {
  const press = (code, mods = {}) => eventCombo({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods, code });
  assert.equal(press("KeyP", { ctrlKey: true, shiftKey: true }), "ctrl+shift+p");
  assert.equal(press("Backquote", { ctrlKey: true }), "ctrl+`");
  assert.equal(press("Digit5", { ctrlKey: true, shiftKey: true }), "ctrl+shift+5");
  assert.equal(press("F12"), "f12");
  assert.equal(press("ArrowUp", { altKey: true }), "alt+up");
  assert.equal(press("ShiftLeft", { shiftKey: true }), null);
});

test("skipCommands adds the setting's commands and takes away the ones it starts with -", () => {
  const skip = skipCommands(["a", "b"], ["c", "-a"]);
  assert.deepEqual([...skip].sort(), ["b", "c"]);
});

test("keysForVsCode: the keys of commands that skip the shell, and the first key of chords", () => {
  const bindings = [
    { key: "ctrl+p", command: "workbench.action.quickOpen" },
    { key: "ctrl+e", command: "some.other.command" },
    { key: "ctrl+k ctrl+s", command: "workbench.action.openGlobalKeybindings" },
    { key: "ctrl+shift+p", command: "workbench.action.showCommands" },
  ];
  const skip = new Set(["workbench.action.quickOpen", "workbench.action.showCommands"]);
  assert.deepEqual(keysForVsCode({ bindings, skip }), ["ctrl+k", "ctrl+p", "ctrl+shift+p"]);
  assert.deepEqual(keysForVsCode({ bindings, skip, allowChords: false }), ["ctrl+p", "ctrl+shift+p"]);
  assert.deepEqual(keysForVsCode({ bindings, skip, sendKeybindingsToShell: true }), []);
});

test("keysForVsCode leaves out bindings that need a focus the view never has", () => {
  const skip = new Set(["x"]);
  const at = (when) => keysForVsCode({ bindings: [{ key: "ctrl+e", command: "x", when }], skip });
  assert.deepEqual(at("terminalFocus && terminalHasBeenCreated"), []);
  assert.deepEqual(at("editorTextFocus"), []);
  assert.deepEqual(at("!terminalFocus"), ["ctrl+e"]);
  assert.deepEqual(at("terminalFocus || sideBarVisible"), ["ctrl+e"]);
  assert.deepEqual(at(undefined), ["ctrl+e"]);
});

test("keysForVsCode honors a user binding that removes a default one", () => {
  const skip = new Set(["workbench.action.quickOpen"]);
  const bindings = [
    { key: "ctrl+p", command: "workbench.action.quickOpen" },
    { key: "ctrl+p", command: "-workbench.action.quickOpen" },
    { key: "ctrl+alt+o", command: "workbench.action.quickOpen" },
  ];
  assert.deepEqual(keysForVsCode({ bindings, skip }), ["ctrl+alt+o"]);
});

test("keysForVsCode never takes the agents' keys: copy, paste and keys without Ctrl, Alt or Meta", () => {
  const skip = new Set(["x"]);
  const keys = ["ctrl+c", "ctrl+v", "ctrl+shift+c", "ctrl+shift+v", "escape", "enter", "shift+tab", "up", "f5"];
  const out = keysForVsCode({ bindings: keys.map((key) => ({ key, command: "x" })), skip });
  assert.deepEqual(out, ["f5"]);
});

test("the setting adds keys and takes away the ones it starts with -", () => {
  const skip = new Set(["workbench.action.quickOpen"]);
  const bindings = [{ key: "ctrl+p", command: "workbench.action.quickOpen" }];
  assert.deepEqual(keysForVsCode({ bindings, skip, extra: ["ctrl+e", "-ctrl+p", "Shift+Ctrl+L"] }), ["ctrl+e", "ctrl+shift+l"]);
});

test("without the bindings, the fallback list applies, with the setting on top", () => {
  assert.ok(FALLBACK.includes("ctrl+p") && FALLBACK.includes("ctrl+shift+p"));
  assert.deepEqual(keysForVsCode({ bindings: undefined, skip: new Set(), extra: ["ctrl+e"] }), [...new Set([...FALLBACK, "ctrl+e"])].sort());
});
