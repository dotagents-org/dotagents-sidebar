// Which keys VS Code keeps while a session has focus, worked out like the integrated terminal
// does (terminalInstance.ts): the keys bound to the commands that skip the shell, and the first
// key of chords. VS Code does that with its keybinding service, which an extension can't reach,
// so this reads the bindings themselves and leaves the `when` conditions out, but for those that
// need a focus the view never has.
//
// Shared by the extension (CommonJS) and the view (a script that sets window.agentKeys).

(function (exports) {
  // A JSON file with comments and trailing commas, as VS Code's keybindings files are
  function parseJsonc(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        const start = i;
        for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
        out += text.slice(start, i + 1);
      } else if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        out += "\n";
      } else if (c === "/" && text[i + 1] === "*") {
        i = text.indexOf("*/", i + 2);
        if (i < 0) break;
        i++;
      } else out += c;
    }
    try {
      return JSON.parse(out.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      return undefined;
    }
  }

  // KeyboardEvent.code to the name the bindings use, so a key is the same on any layout
  const CODES = {
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", IntlBackslash: "oem_102",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    PageUp: "pageup", PageDown: "pagedown", Home: "home", End: "end", Insert: "insert", Delete: "delete",
    Backspace: "backspace", Tab: "tab", Enter: "enter", NumpadEnter: "enter", Escape: "escape", Space: "space",
    NumpadAdd: "numpad_add", NumpadSubtract: "numpad_subtract", NumpadMultiply: "numpad_multiply",
    NumpadDivide: "numpad_divide", NumpadDecimal: "numpad_decimal",
  };

  function codeName(code) {
    if (CODES[code]) return CODES[code];
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1].toLowerCase();
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return `numpad${m[1]}`;
    if ((m = /^F(\d{1,2})$/.exec(code))) return `f${m[1]}`;
    return null;
  }

  const MODIFIERS = { ctrl: "ctrl", shift: "shift", alt: "alt", meta: "meta", cmd: "meta", win: "meta", super: "meta" };
  const ORDER = ["ctrl", "shift", "alt", "meta"];

  function combo(mods, key) {
    return key ? [...ORDER.filter((m) => mods.has(m)), key].join("+") : null;
  }

  // One key of a binding ("Shift+Ctrl+P", "ctrl+[Backquote]") in a single form ("ctrl+shift+p")
  function normalize(text) {
    const parts = String(text).trim().split("+");
    const last = parts.pop();
    const mods = new Set();
    for (const p of parts) {
      const mod = MODIFIERS[p.toLowerCase()];
      if (!mod) return null;
      mods.add(mod);
    }
    // A scan code ("[Backquote]"), as VS Code writes keys it can't name on the layout
    const scan = /^\[(\w+)\]$/.exec(last);
    return combo(mods, scan ? codeName(scan[1]) : last.toLowerCase() || null);
  }

  function eventCombo(event) {
    const mods = new Set();
    if (event.ctrlKey) mods.add("ctrl");
    if (event.shiftKey) mods.add("shift");
    if (event.altKey) mods.add("alt");
    if (event.metaKey) mods.add("meta");
    return combo(mods, codeName(event.code));
  }

  // The commands whose keys go to VS Code: VS Code's defaults, plus commandsToSkipShell, where a
  // command starting with - leaves the defaults
  function skipCommands(defaults, setting = []) {
    const skip = new Set(defaults);
    for (const c of setting) c.startsWith("-") ? skip.delete(c.slice(1)) : skip.add(c);
    return skip;
  }

  // Focus contexts that are never true while the view has focus: a binding that needs one of
  // them can't fire here, so its key stays with the agent
  const OTHER_FOCUS = new Set([
    "terminalFocus", "terminalTextSelected", "terminalFindFocused", "editorTextFocus", "editorFocus",
    "textInputFocus", "inputFocus", "listFocus", "inQuickOpen", "suggestWidgetVisible", "notificationFocus",
  ]);

  function needsOtherFocus(when) {
    if (!when || when.includes("||")) return false;
    return when.split("&&").some((term) => OTHER_FOCUS.has(term.replace(/[()\s]/g, "")));
  }

  // The agents' own keys never go to VS Code: copy, paste, and keys without Ctrl, Alt or Meta
  // (Escape, Enter, arrows...), but function keys
  function agentKey(key) {
    if (["ctrl+c", "ctrl+v", "ctrl+shift+c", "ctrl+shift+v"].includes(key)) return true;
    return !/(^|\+)(ctrl|alt|meta)\+/.test(key) && !/^(shift\+)?f\d{1,2}$/.test(key);
  }

  // What the view used before reading the bindings, and still uses when they can't be read
  const FALLBACK = [
    ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
    "ctrl+p", "ctrl+b", "ctrl+j", "ctrl+k", "ctrl+,", "ctrl+`", "ctrl+tab", "ctrl+pageup", "ctrl+pagedown",
    "ctrl+shift+p", "ctrl+shift+e", "ctrl+shift+f", "ctrl+shift+g", "ctrl+shift+x", "ctrl+shift+`", "ctrl+shift+5",
  ];

  function keysForVsCode({ bindings, skip, allowChords = true, sendKeybindingsToShell = false, extra = [] }) {
    const keys = new Set();
    if (!sendKeybindingsToShell) {
      if (!bindings) FALLBACK.forEach((k) => keys.add(k));
      else {
        // A user binding to -command removes that command's binding on the same key
        const removed = new Set(
          bindings.filter((b) => typeof b.command === "string" && b.command.startsWith("-")).map((b) => `${b.command.slice(1)} ${b.key}`)
        );
        for (const b of bindings) {
          if (typeof b.key !== "string" || typeof b.command !== "string" || b.command.startsWith("-")) continue;
          if (removed.has(`${b.command} ${b.key}`) || needsOtherFocus(b.when)) continue;
          const chord = b.key.trim().split(/\s+/);
          const first = normalize(chord[0]);
          if (!first || agentKey(first)) continue;
          if (chord.length > 1 ? allowChords : skip.has(b.command)) keys.add(first);
        }
      }
    }
    for (const e of extra) {
      const key = normalize(e.replace(/^-/, ""));
      if (key) e.startsWith("-") ? keys.delete(key) : keys.add(key);
    }
    return [...keys].sort();
  }

  Object.assign(exports, { parseJsonc, normalize, eventCombo, skipCommands, keysForVsCode, FALLBACK });
})(typeof module === "object" ? module.exports : (window.agentKeys = {}));
