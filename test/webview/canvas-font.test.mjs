import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// The same file the view loads as a script
const { trimLeadingWhitespace } = createRequire(import.meta.url)("../../webview/terminals/canvas-font.js");

// A window whose 2D canvas keeps its font when the new one starts with whitespace, as Chromium in
// recent VS Code builds does, or takes it as browsers otherwise do
function fakeWindow({ rejectsLeadingWhitespace }) {
  class CanvasRenderingContext2D {
    #font = "10px sans-serif";
    get font() {
      return this.#font;
    }
    set font(value) {
      if (rejectsLeadingWhitespace && /^\s/.test(value)) return;
      this.#font = value.trim();
    }
  }
  return { CanvasRenderingContext2D, document: { createElement: () => ({ getContext: () => new CanvasRenderingContext2D() }) } };
}

test("a canvas that ignores a font starting with whitespace gets it trimmed, so xterm's atlas uses the terminal's font", () => {
  const win = fakeWindow({ rejectsLeadingWhitespace: true });
  assert.equal(trimLeadingWhitespace(win), true);
  const ctx = new win.CanvasRenderingContext2D();
  ctx.font = " normal 14px JetBrains Mono"; // what xterm's WebGL atlas sets for text that isn't italic
  assert.equal(ctx.font, "normal 14px JetBrains Mono");
});

test("a canvas without the bug is left alone", () => {
  const win = fakeWindow({ rejectsLeadingWhitespace: false });
  const before = Object.getOwnPropertyDescriptor(win.CanvasRenderingContext2D.prototype, "font");
  assert.equal(trimLeadingWhitespace(win), false);
  assert.equal(Object.getOwnPropertyDescriptor(win.CanvasRenderingContext2D.prototype, "font").set, before.set);
});
