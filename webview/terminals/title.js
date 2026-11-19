// What an agent's window title says about its conversation. Codex joins the items of its title with
// " | ", by default the thread's name and then the project, but tui.terminal_title in its
// config.toml may put them in any order. The project is the workspace's name, cut to 24 characters
// ("..." in the last 3) when longer: the part that is the workspace's name is dropped wherever it
// is, and, when no part is, the last one, which is where Codex puts the project by default.
//
// Shared by the extension's tests (CommonJS) and the view (a script that declares agentTitle).

const agentTitle = (() => {
  // The status mark in front (a spinner, ✳) goes
  const strip = (text) => text.replace(/^[^\p{L}\p{N}]+/u, "").trim();

  // The project as Codex writes it: whole up to 24 characters, else 21 and "..."
  const asCodex = (name) => {
    const chars = [...name];
    return chars.length > 24 ? `${chars.slice(0, 21).join("")}...` : name;
  };

  function codex(raw, workspace) {
    const parts = raw.split(" | ");
    if (parts.length < 2) return strip(raw);
    const project = workspace ? [workspace, asCodex(workspace)] : [];
    const kept = parts.filter((part) => !project.includes(strip(part)));
    return strip((kept.length < parts.length ? kept : parts.slice(0, -1)).join(" | "));
  }

  return { strip, codex };
})();
if (typeof module === "object") module.exports = { ...agentTitle };
