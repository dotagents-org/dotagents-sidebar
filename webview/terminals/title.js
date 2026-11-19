// What an agent's window title says about its conversation. Codex joins the items of its title with
// " | ", by default the thread's name and then the project, but tui.terminal_title in its
// config.toml may put them in any order. The project is the name of the folder Codex runs in (or of
// its project root), cut to 24 characters ("..." in the last 3) when longer: the one part that is
// the session's folder's name is dropped when it is the last part, where Codex puts the project by
// default. Anywhere else it may be the thread's own name, and the workspace's name is no proof (a
// thread may be named so), and a project root above the folder isn't known here: then the title
// stays whole, since better the project shown than the thread's name lost.
//
// Shared by the extension's tests (CommonJS) and the view (a script that declares agentTitle).

const agentTitle = (() => {
  // The status mark in front goes, by the form each agent gives it: Codex's braille spinner, Claude Code's
  // ✳ family and the dots of an idle state. Nothing else: a title may start with "[RFC]" or "*", or end in ".private"
  const CODEX_MARK = /^[\u2800-\u28FF]+\s*/u;
  const CLAUDE_MARK = /^[\u2800-\u28FF\u2733-\u273D\u2722-\u2725\u00B7\u2022\u25CF\u25CB\u25CC\u25D0-\u25D3]+\s*/u;
  const strip = (text, agent = "claude") => text.replace(agent === "codex" ? CODEX_MARK : CLAUDE_MARK, "").trim();

  // The project as Codex writes it: whole up to 24 graphemes (a letter and its accents count as
  // one), else 21 and "..."
  const graphemes = (text) => (typeof Intl === "object" && Intl.Segmenter ? [...new Intl.Segmenter().segment(text)].map((g) => g.segment) : [...text]);
  const asCodex = (name) => {
    const chars = graphemes(name);
    return chars.length > 24 ? `${chars.slice(0, 21).join("")}...` : name;
  };

  // names: what the project may be called (the session's folder's name). Exactly
  // one part may go: when none or several match (a thread named as its project), it stays whole
  function codex(raw, names) {
    const parts = raw.split(" | ");
    if (parts.length < 2) return strip(raw, "codex");
    const project = names.filter(Boolean).flatMap((name) => [name, asCodex(name)]);
    const matches = parts.filter((part) => project.includes(strip(part, "codex")));
    // Only the last part, where Codex puts the project by default: a thread may be named as the folder
    return strip(matches.length === 1 && matches[0] === parts.at(-1) ? parts.slice(0, -1).join(" | ") : raw, "codex");
  }

  return { strip, codex };
})();
if (typeof module === "object") module.exports = { ...agentTitle };
