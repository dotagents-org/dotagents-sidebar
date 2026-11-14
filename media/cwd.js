// The folder a terminal session is in, as the shell reports it, and how the title names it.
// The shell sends OSC 7 (bash, through shell/bash-cwd.sh: file://host/path) or, on Windows, OSC 9;9
// (PowerShell: the path, which ConEmu and Windows Terminal also send quoted).
//
// Shared by the extension's tests (CommonJS) and the view (a script that sets window.agentCwd).

(function (exports) {
  // The path an OSC 7 or OSC 9;9 payload carries, or null
  function fromOsc(ident, data) {
    let path;
    if (ident === 7) {
      const m = /^file:\/\/[^/]*(\/.*)$/i.exec(data);
      if (!m) return null;
      try {
        path = decodeURIComponent(m[1]);
      } catch {
        path = m[1];
      }
      if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1); // file:///C:/Users
    } else if (ident === 9) {
      const m = /^9;(.+)$/s.exec(data);
      if (!m) return null;
      path = m[1].replace(/^"(.*)"$/, "$1");
    } else return null;
    return path && path.length <= 1024 ? path : null;
  }

  // What the title shows, as the parts of a path: from the workspace (named rootName) when the
  // folder is inside it, from ~ when it is in the home folder, else the whole path
  function segments(path, { root, rootName, home } = {}) {
    const clean = (p) => String(p).replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
    const p = clean(path);
    // A Windows drive is case-insensitive
    const inside = (base) => {
      if (!base) return null;
      const b = clean(base);
      const fold = /^[A-Za-z]:/.test(b) ? (x) => x.toLowerCase() : (x) => x;
      if (fold(p) === fold(b)) return "";
      return fold(p).startsWith(fold(b) + "/") ? p.slice(b.length + 1) : null;
    };
    const parts = (rest) => rest.split("/").filter(Boolean);
    let rest = rootName ? inside(root) : null;
    if (rest !== null) return [rootName, ...parts(rest)];
    rest = inside(home);
    if (rest !== null) return ["~", ...parts(rest)];
    const all = parts(p);
    if (p.startsWith("/")) return all.length ? ["/" + all[0], ...all.slice(1)] : ["/"];
    return all.length ? all : [p];
  }

  Object.assign(exports, { fromOsc, segments });
})(typeof module === "object" ? module.exports : (window.agentCwd = {}));
