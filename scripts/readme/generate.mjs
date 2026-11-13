// Generates the README's pictures of the accounts into assets/readme/, each in a light and a dark
// version (the README picks one with <picture>): the avatars at work and their states.
//
// The avatars come from assets/avatars/ (still/ and strip/, saved from scripts/avatars/generate.mjs):
//   node scripts/readme/generate.mjs
// GitHub shows these through <img>, so they carry no web fonts and no scripts; the motion is SMIL.
// The README shows PNGs of them, since the extension packager refuses SVGs in a README; after
// generating, render each <name>.svg at 2x with a transparent background, for example:
//   chrome --headless=new --force-device-scale-factor=2 --default-background-color=00000000 \
//     --window-size=<width>,<height> --screenshot=<name>.png <a page with the SVG at its size>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");
const avatarsDir = path.join(ASSETS, "avatars", "still");
const OUT = path.join(ASSETS, "readme");
fs.mkdirSync(OUT, { recursive: true });

// The identity's roles, light and dark.
const THEMES = {
  light: { text: "#171717", muted: "#666666", card: "#ffffff", line: "#e3e3e3", group: "#fafafa", arrow: "#a1a1a1", pill: "#171717", pillText: "#ffffff", shadow: "#000000", shadowOpacity: 0.06, turing: "#D77655", lovelace: "#376B80" },
  dark: { text: "#ededed", muted: "#a0a0a0", card: "#111111", line: "#2b2b2b", group: "#0a0a0a", arrow: "#6b6b6b", pill: "#ededed", pillText: "#0a0a0a", shadow: "#000000", shadowOpacity: 0.5, turing: "#e39478", lovelace: "#6fa3b8" },
};
const FONT = `ui-monospace, 'Geist Mono', SFMono-Regular, Menlo, Consolas, monospace`;
const CHAR = 0.6; // a monospace character's width, in em

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const width = (text, size) => text.length * size * CHAR;

// One avatar, without its <svg> wrapper, to place inside a picture.
function avatarSvg(file) {
  const svg = fs.readFileSync(path.join(avatarsDir, file), "utf8");
  return svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/<title>[^<]*<\/title>/g, "");
}

// --- Building blocks ---------------------------------------------------------------------------
function frame(w, h, t, body, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" font-family="${FONT}">
<defs>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="${t.shadow}" flood-opacity="${t.shadowOpacity}"/></filter>
<marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="${t.arrow}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
</defs>
${body}
</svg>
`;
}

// On the dark background the brand's near-black body would vanish: there it is lifted a little.
function write(name, make) {
  for (const [theme, t] of Object.entries(THEMES)) {
    const svg = make(t);
    fs.writeFileSync(path.join(OUT, `${name}-${theme}.svg`), theme === "dark" ? svg.replace(/fill="#171717"/g, 'fill="#2e2e2e"') : svg);
  }
}

// --- The avatars at work: the brand and the two accounts, hopping ------------------------------
function animated(who) {
  const strip = fs.readFileSync(path.join(avatarsDir, "..", "strip", `${who}-working.svg`), "utf8");
  // The strip puts a frame every 100, but an avatar draws up to 6 past its frame, the margin the
  // -6 -6 112 112 window shows: the neighbours' edges would peek in. A frame every 200 keeps them out.
  let frames = 0;
  const inner = strip
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "")
    .replace(/<svg x="(\d+)" y="0" width="100" height="100"/g, (_, x) => (frames++, `<svg x="${2 * x}" y="0" width="100" height="100"`));
  if (frames !== 24) throw new Error(`${who}: expected 24 frames in the strip, found ${frames}`);
  const values = Array.from({ length: 24 }, (_, i) => `${-i * 200} 0`).join(";");
  return `<svg viewBox="-6 -6 112 112" overflow="hidden"><g><animateTransform attributeName="transform" type="translate" values="${values}" dur="3s" calcMode="discrete" repeatCount="indefinite"/>${inner}</g></svg>`;
}
write("avatars", (t) => {
  const size = 96, gap = 56, w = 3 * size + 2 * gap;
  const who = [["dotagents", "the brand"], ["turing", "an account"], ["lovelace", "another"]];
  let body = "";
  who.forEach(([name], i) => {
    const x = i * (size + gap);
    body += animated(name).replace("<svg ", `<svg x="${x}" y="0" width="${size}" height="${size}" `);
    body += `<text x="${x + size / 2}" y="${size + 24}" font-size="13" font-weight="700" text-anchor="middle" fill="${name === "dotagents" ? t.text : t[name]}">${name}</text>`;
  });
  return frame(w, size + 34, t, body, "The dotagents avatars at work: the brand, turing and lovelace, hopping");
});

// --- The states, for each avatar ---------------------------------------------------------------
const STATES = [["ok", "all good"], ["working", "a session works"], ["waiting", "waiting on you"], ["warn", "70% or runs out"], ["limit", "at the limit"], ["error", "sign in again"], ["asleep", "no fresh data"]];
write("states", (t) => {
  const size = 56, col = 104, row = 84, left = 108, top = 44;
  let body = "";
  STATES.forEach(([state, meaning], j) => {
    const cx = left + j * col + size / 2;
    body += `<text x="${cx}" y="16" font-size="12" font-weight="700" text-anchor="middle" fill="${t.text}">${state}</text>`;
    body += `<text x="${cx}" y="32" font-size="10" text-anchor="middle" fill="${t.muted}">${meaning}</text>`;
  });
  ["dotagents", "turing", "lovelace"].forEach((who, i) => {
    const y = top + i * row;
    body += `<text x="0" y="${y + size / 2 + 5}" font-size="13" font-weight="700" fill="${who === "dotagents" ? t.text : t[who]}">${who}</text>`;
    STATES.forEach(([state], j) => {
      body += `<svg x="${left + j * col}" y="${y}" width="${size}" height="${size}" viewBox="-6 -6 112 112" overflow="visible">${avatarSvg(`${who}-${state}.svg`)}</svg>`;
    });
  });
  return frame(left + STATES.length * col - (col - size) + 30, top + 3 * row - (row - size) + 4, t, body, "The avatars' states: the eyes and the dot say how each account is");
});
