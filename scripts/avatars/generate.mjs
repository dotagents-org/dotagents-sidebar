// Generates the dotagents avatars: the brand (the `..` face) and one per account, in each state.
//
// The accounts tab draws the avatars live (media/accounts/avatar.js), so this script only makes
// pictures of them, for documents:
//   still/<who>-<state>.svg   one frame
//   strip/<who>-working.svg   24 frames of 3 s side by side
// The rules here and in avatar.js are the same; a change goes to both.
//
// The pictures are saved in assets/avatars/; run it again only after changing an avatar:
//   node scripts/avatars/generate.mjs assets/avatars

import fs from "node:fs";
import path from "node:path";

const [out] = process.argv.slice(2);
if (!out) throw new Error("usage: node generate.mjs <output folder>");

// Who: the body is who it is (shape and color); the eyes are the state.
const WHO = {
  dotagents: {
    color: "#171717",
    dots: true, // the brand keeps its round `..` eyes
    progress: "#8f8f8f",
    body: "M33 12H67C78.6 12 88 21.4 88 33V67C88 78.6 78.6 88 67 88H33C21.4 88 12 78.6 12 67V33C12 21.4 21.4 12 33 12Z",
    eyes: { y: 48, spacing: 24, scale: 1.3 },
  },
  turing: {
    color: "#D77655",
    ink: "#151515",
    body: "M30 14H70C80 14 86 20 86 30V70C86 80 80 86 70 86H30C20 86 14 80 14 70V30C14 20 20 14 30 14Z",
    eyes: { y: 47, spacing: 26, scale: 1.4 },
  },
  lovelace: {
    color: "#376B80",
    ink: "#f5f5f5",
    body: "M50 12A38 38 0 1 1 49.99 12Z",
    eyes: { y: 47, spacing: 24, scale: 1.3 },
  },
};

// The brand's eyes are always light: the state's color goes in the dot, for every avatar.
const BRAND_EYES_INK = "#ededed";

// Every avatar shows its state's color in a dot at the corner, like presence in a chat; the eyes
// keep only the shape. On an account's body a colored eye fades (1.1:1 for red on turing's
// orange). Red: it needs you; amber: it asks for attention; green: all good; blue with a moon:
// asleep. A ring around the dot is the other state of the same color: limit (red, it comes back
// by itself at the reset) and waiting (amber, a session waits for you).
const DOT = {
  error: `<circle cx="84" cy="84" r="10" fill="#ee1d36" stroke="#ffffff" stroke-width="3"/>`,
  limit: `<circle cx="84" cy="84" r="12" fill="#ffffff"/><circle cx="84" cy="84" r="9.5" fill="none" stroke="#ee1d36" stroke-width="2.6"/><circle cx="84" cy="84" r="5.2" fill="#ee1d36"/>`,
  waiting: `<circle cx="84" cy="84" r="12" fill="#ffffff"/><circle cx="84" cy="84" r="9.5" fill="none" stroke="#f58a00" stroke-width="2.6"/><circle cx="84" cy="84" r="5.2" fill="#f58a00"/>`,
  warn: `<circle cx="84" cy="84" r="10" fill="#f58a00" stroke="#ffffff" stroke-width="3"/>`,
  // working shows itself with the dots below; no status dot.
  working: "",
  ok: `<circle cx="84" cy="84" r="10" fill="#00b84d" stroke="#ffffff" stroke-width="3"/>`,
  asleep: `<circle cx="84" cy="84" r="10" fill="#2f7bf5" stroke="#ffffff" stroke-width="3"/><path d="M87.5 78.8A5.6 5.6 0 1 0 89.2 87.2A4.4 4.4 0 0 1 87.5 78.8Z" fill="#ffffff"/>`,
};

// The seven states, most urgent first.
const STATES = {
  error: { glyph: "x" },
  limit: { glyph: "chevron" },
  waiting: { lower: 1.5, glyph: "wide" }, // looking at you: the eyes sit a little lower
  warn: { brows: true },
  working: { hop: true },
  ok: {},
  asleep: { glyph: "dash" },
};

const GLYPH = {
  // The pill of an account's eyes.
  pill: (cx, cy, ink, left, scale) => `<rect x="${cx - 2.9 * scale}" y="${cy - 7.975 * scale}" width="${5.8 * scale}" height="${15.95 * scale}" rx="${2.9 * scale}" fill="${ink}"/>`,
  dash: (cx, cy, ink) => `<rect x="${cx - 6}" y="${cy - 2.2}" width="12" height="4.4" rx="2.2" fill="${ink}"/>`,
  dot: (cx, cy, ink) => `<circle cx="${cx}" cy="${cy}" r="7" fill="${ink}"/>`,
  // Round and a little bigger, looking at you: waiting for an answer.
  wide: (cx, cy, ink) => `<circle cx="${cx}" cy="${cy}" r="7.5" fill="${ink}"/>`,
  x: (cx, cy, ink) => `<path d="M${cx - 5} ${cy - 5}L${cx + 5} ${cy + 5}M${cx + 5} ${cy - 5}L${cx - 5} ${cy + 5}" stroke="${ink}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  // ">" on the left eye, "<" on the right: squeezed shut.
  chevron: (cx, cy, ink, left) => `<path d="M${cx + (left ? -4 : 4)} ${cy - 7}L${cx + (left ? 5 : -5)} ${cy}L${cx + (left ? -4 : 4)} ${cy + 7}" stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
};

// The two eyes of a state; brows go above them.
function eyes(w, { glyph, brows, lower = 0 }, ink) {
  const { y, spacing, scale } = w.eyes;
  const kind = glyph ?? (w.dots ? "dot" : "pill");
  return [true, false].map((left) => {
    const cx = 50 + (left ? -spacing / 2 : spacing / 2), cy = y + lower;
    let eye = GLYPH[kind](cx, cy, ink, left, scale);
    if (brows) {
      const top = cy - (kind === "dot" ? 7 : 7.975 * scale) - 4;
      eye += `<path d="${left ? `M${cx - 6} ${top + 1}L${cx + 5} ${top - 4}` : `M${cx + 6} ${top + 1}L${cx - 5} ${top - 4}`}" stroke="${ink}" stroke-width="3.6" stroke-linecap="round" fill="none"/>`;
    }
    return eye;
  }).join("");
}

const FRAMES = 24;
const LOOP = 3;

function frame(who, state, i) {
  const w = WHO[who], s = STATES[state];
  const ink = w.dots ? BRAND_EYES_INK : w.ink;
  const p = i / FRAMES;
  let inner = `<path d="${w.body}" fill="${w.color}"/>${eyes(w, s, ink)}`;
  let extra = "";
  if (s.hop) {
    // Two hops per loop, a little squash where it lands, and three dots below lighting in turn.
    const hop = Math.abs(Math.sin(p * Math.PI * 2));
    const [sx, sy] = hop < 0.15 ? [1.05, 0.93] : [1, 1];
    inner = `<g transform="translate(50 92) scale(${sx} ${sy}) translate(-50 -92) translate(0 ${+(-6 * hop).toFixed(2)})">${inner}</g>`;
    const lit = Math.floor(p * 6) % 3;
    extra += [0, 1, 2].map((k) => `<circle cx="${38 + k * 12}" cy="95" r="4.4" fill="${w.progress ?? w.color}" opacity="${k === lit ? 1 : 0.3}"/>`).join("");
  }
  extra += DOT[state];
  return inner + extra;
}

for (const dir of ["still", "strip"]) fs.mkdirSync(path.join(out, dir), { recursive: true });
for (const who of Object.keys(WHO)) {
  for (const state of Object.keys(STATES)) {
    fs.writeFileSync(path.join(out, "still", `${who}-${state}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" overflow="visible" role="img" aria-label="${who}, ${state}">${frame(who, state, 0)}</svg>`);
    if (!STATES[state].hop) continue; // only a moving state has a strip
    let strip = "";
    for (let i = 0; i < FRAMES; i++) strip += `<svg x="${i * 100}" y="0" width="100" height="100" viewBox="0 0 100 100" overflow="visible">${frame(who, state, i)}</svg>`;
    fs.writeFileSync(path.join(out, "strip", `${who}-${state}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${100 * FRAMES} 100" width="${100 * FRAMES}" height="100">${strip}</svg>`);
  }
}
console.log(`${Object.keys(WHO).length * Object.keys(STATES).length} avatars in ${out}`);
