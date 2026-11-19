// What an agent's window title says about its conversation. Codex joins the items of its title with
// " | ", by default the thread's name and then the project, but tui.terminal_title in its
// config.toml may put them in any order. The project is the name of the folder Codex runs in (or of
// its project root), cut to 24 characters ("..." in the last 3) when longer: the part that is one
// of the names the view knows for it (the session's folder, the workspace) is dropped wherever it
// is. When no part is, the title stays whole: better the project shown than the thread's name lost.
//
// Shared by the extension's tests (CommonJS) and the view (a script that declares agentTitle).

const agentTitle = (() => {
  // The status mark in front (a spinner, ✳) goes
  const strip = (text) => text.replace(/^[^\p{L}\p{N}]+/u, "").trim();

  // The project as Codex writes it: whole up to 24 graphemes (a letter and its accents count as
  // one), else 21 and "..."
  const graphemes = (text) => (typeof Intl === "object" && Intl.Segmenter ? [...new Intl.Segmenter().segment(text)].map((g) => g.segment) : [...text]);
  const asCodex = (name) => {
    const chars = graphemes(name);
    return chars.length > 24 ? `${chars.slice(0, 21).join("")}...` : name;
  };

  // names: what the project may be called (the session's folder's name, the workspace's). Exactly
  // one part may go: when none or several match (a thread named as its project), it stays whole
  function codex(raw, names) {
    const parts = raw.split(" | ");
    if (parts.length < 2) return strip(raw);
    const project = names.filter(Boolean).flatMap((name) => [name, asCodex(name)]);
    const matches = parts.filter((part) => project.includes(strip(part)));
    return strip(matches.length === 1 ? parts.filter((part) => part !== matches[0]).join(" | ") : raw);
  }

  return { strip, codex };
})();
if (typeof module === "object") module.exports = { ...agentTitle };
