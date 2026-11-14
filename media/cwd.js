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

  // A Windows path has a drive (C:\x, or C:/x from an OSC 7) or is a share (\\host\x)
  const isWindows = (path) => /^[A-Za-z]:|^\\\\/.test(String(path));

  // What separates the parts of the path in the title: the platform's own
  const separator = (path) => (isWindows(path) ? "\\" : "/");

  // What the title shows, as the parts of a path. A Windows path is shown as Windows shows it
  // (C:\Users\me\work); on Linux, from ~ when the folder is in the home folder, else the whole path
  function segments(path, { home } = {}) {
    const raw = String(path);
    const p = raw.replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
    const parts = (rest) => rest.split("/").filter(Boolean);
    if (isWindows(raw)) {
      const all = parts(p);
      if (raw.startsWith("\\\\")) return ["\\\\" + all[0], ...all.slice(1)];
      return all.length === 1 ? [all[0] + "\\"] : all; // a drive's root keeps its backslash: C:\
    }
    const base = home && String(home).replace(/(.)\/+$/, "$1");
    if (base && p === base) return ["~"];
    if (base && p.startsWith(base + "/")) return ["~", ...parts(p.slice(base.length + 1))];
    const all = parts(p);
    if (p.startsWith("/")) return all.length ? ["/" + all[0], ...all.slice(1)] : ["/"];
    return all.length ? all : [p];
  }

  Object.assign(exports, { fromOsc, segments, separator });
})(typeof module === "object" ? module.exports : (window.agentCwd = {}));
