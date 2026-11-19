// Chromium in recent VS Code builds ignores a canvas font that starts with whitespace and keeps
// "10px sans-serif". xterm's WebGL renderer builds its glyph atlas with such a font (" normal 14px
// ..." when the text isn't italic), so letters were drawn small and thin inside full-width cells.
// VS Code fixes it for its own window (terminalFontRendering.ts); the view is another window, so it
// needs the same fix: trim the leading whitespace before the font is set. Only applied when this
// window's canvas has the bug.
//
// Shared by the extension's tests (CommonJS) and the view (a script that declares agentCanvasFont).

const agentCanvasFont = (() => {
  const leading = /^[ \t\r\n\f]+/;

  function trimLeadingWhitespace(win) {
    const ctx = win.document.createElement("canvas").getContext("2d");
    if (!ctx) return false;
    ctx.font = " 24px monospace";
    if (ctx.font !== "10px sans-serif") return false;
    for (const ctor of [win.CanvasRenderingContext2D, win.OffscreenCanvasRenderingContext2D]) {
      const proto = ctor && ctor.prototype;
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "font");
      if (!descriptor || !descriptor.set) continue;
      const set = descriptor.set;
      Object.defineProperty(proto, "font", {
        ...descriptor,
        set(value) {
          set.call(this, typeof value === "string" ? value.replace(leading, "") : value);
        },
      });
    }
    return true;
  }

  return { trimLeadingWhitespace };
})();
if (typeof module === "object") module.exports = { ...agentCanvasFont };
