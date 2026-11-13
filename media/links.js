// File paths in a terminal line, as candidates for links: where each starts and ends in the text,
// the path, and the line and column it points at. Whether a candidate is a link is the extension's
// call (the file has to exist), so this errs on finding too many rather than too few.
//
// The shapes follow VS Code's integrated terminal (terminalLinkParsing.ts), cut down to what the
// agents print: a path with a slash or a file name with an extension, absolute (/, ~/, C:\ on
// Windows, file://) or relative, and a path with spaces only in double quotes. The place after it:
// :12, :12:7, (12), (12,7), or ", line 12" with ", column 7".
//
// Shared by the extension's tests (CommonJS) and the view (a script that sets window.agentLinks).

(function (exports) {
  const MAX_LINE = 2000; // longer lines are output, not something to click in
  const MAX_LINKS = 10; // per line, as VS Code

  // The place a path points at, right after it
  const SUFFIX = /^(?::(\d+)(?::(\d+))?| ?\((\d+)(?:,\s*(\d+))?\)|,? line (\d+)(?:, column (\d+))?)/;
  // A path without spaces: a slash somewhere, or a name with an extension (a letter first, so
  // versions and decimals stay out)
  const BARE = /(?:file:\/\/)?(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?[\w.@+~-]*(?:[\\/][\w.@+~-]+)+[\\/]?|[\w@+~-][\w.@+~-]*\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;
  const QUOTED = /"([^"\n]{1,1024})"/g;
  // What ends a sentence or wraps a path, taken off its end
  const TRAILING = /[.,;:!?'"`)\]}>]+$/;

  function placeAfter(text, end) {
    const m = SUFFIX.exec(text.slice(end));
    if (!m) return { end, line: undefined, column: undefined };
    const line = m[1] || m[3] || m[5];
    const column = m[2] || m[4] || m[6];
    return { end: end + m[0].length, line: Number(line), column: column ? Number(column) : undefined };
  }

  // URLs other than file://: their paths belong to them, not to files
  const URL = /\b(?!file:)[a-z][\w+.-]*:\/\/\S+/gi;

  // The candidates in text: [{ start, end, path, line?, column? }], start and end as indexes in text
  // (end exclusive), sorted, never overlapping
  function findPaths(text) {
    if (!text || text.length > MAX_LINE) return [];
    const urls = [...text.matchAll(URL)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    const found = [];
    const taken = (s, e) => [...urls, ...found].some((f) => s < f.end && e > f.start);
    const add = (start, pathEnd, path) => {
      if (!path || /^[\\/.~]+$/.test(path) || taken(start, pathEnd)) return;
      const place = placeAfter(text, pathEnd);
      found.push({ start, end: place.end, path, line: place.line, column: place.column });
    };
    for (const m of text.matchAll(QUOTED)) {
      const inner = m[1].trim();
      if (/[\\/]|\.[A-Za-z]/.test(inner)) add(m.index, m.index + m[0].length, inner);
    }
    for (const m of text.matchAll(BARE)) {
      if (found.length >= MAX_LINKS) break;
      const path = m[0].replace(TRAILING, "");
      add(m.index, m.index + path.length, path);
    }
    return found.sort((a, b) => a.start - b.start).slice(0, MAX_LINKS);
  }

  Object.assign(exports, { findPaths, MAX_LINE, MAX_LINKS });
})(typeof module === "object" ? module.exports : (window.agentLinks = {}));
