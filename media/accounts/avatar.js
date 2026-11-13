// The avatars, live (identity, "Avatares"): flat shapes on a canvas, the body in one color, the
// eyes of each state and the status dot. They blink, and hop while a session works. One
// requestAnimationFrame loop paints every avatar on the page; one taken off the page leaves it.
// A change of state is a short transition, not a cut: the old eyes close and the new ones open,
// the old dot shrinks and the new one pops in, and the hop fades in and out.
// Exposes window.dotagentsAvatar.mount(canvas, { who, color, state, working, size }):
// state is in the eyes and the dot; working, a session at work, in the body, which hops.
"use strict";

(() => {
  const BRAND = "#171717";
  // The bodies, outlines in a 100x100 box, each with its eyes: the height of their center, the
  // distance between them and their size. The brand is a rounded square; an account takes one of
  // SHAPES, in its own color.
  const SQUARE = "M33 12H67C78.6 12 88 21.4 88 33V67C88 78.6 78.6 88 67 88H33C21.4 88 12 78.6 12 67V33C12 21.4 21.4 12 33 12Z";
  // A pebble: a circle bent by two low harmonics, uneven but smooth.
  const PEBBLE = `M${Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2, r = 37.5 * (1 + 0.075 * Math.cos(2 * a + 0.5) + 0.035 * Math.cos(3 * a + 2.1));
    return `${(50 + r * Math.cos(a)).toFixed(1)} ${(50 + r * Math.sin(a)).toFixed(1)}`;
  }).join("L")}Z`;
  const SHAPES = [
    { body: "M30 14H70C80 14 86 20 86 30V70C86 80 80 86 70 86H30C20 86 14 80 14 70V30C14 20 20 14 30 14Z", eyes: { y: 47, spacing: 26, scale: 1.4 } }, // square
    { body: "M50 12A38 38 0 1 1 49.99 12Z", eyes: { y: 47, spacing: 24, scale: 1.3 } }, // circle
    { body: "M26.5 22.8Q31 15 40 15L60 15Q69 15 73.5 22.8L84.5 42.2Q89 50 84.5 57.8L73.5 77.2Q69 85 60 85L40 85Q31 85 26.5 77.2L15.5 57.8Q11 50 15.5 42.2Z", eyes: { y: 48, spacing: 26, scale: 1.3 } }, // hexagon
    { body: "M14 50A36 36 0 0 1 86 50V72C86 80 80 86 72 86H28C20 86 14 80 14 72Z", eyes: { y: 49, spacing: 26, scale: 1.3 } }, // arch
    { body: "M40.8 18.2Q50 9 59.2 18.2L81.8 40.8Q91 50 81.8 59.2L59.2 81.8Q50 91 40.8 81.8L18.2 59.2Q9 50 18.2 40.8Z", eyes: { y: 50, spacing: 22, scale: 1.15 } }, // diamond
    { body: PEBBLE, eyes: { y: 49, spacing: 24, scale: 1.3 } },
  ];
  const BRAND_DEF = { body: SQUARE, eyes: { y: 48, spacing: 24, scale: 1.3 } };
  // turing and lovelace keep the shapes they were drawn with; any other account gets one from
  // its name, always the same.
  const NAMED = { turing: SHAPES[0], lovelace: SHAPES[1] };
  function defFor(who) {
    if (who === "dotagents") return BRAND_DEF;
    if (NAMED[who]) return NAMED[who];
    let hash = 0;
    for (const c of who) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return SHAPES[hash % SHAPES.length];
  }

  // The eyes' ink: the brand's are light; an account's, whichever contrasts more with its body.
  function inkFor(who, color) {
    if (who === "dotagents") return "#ededed";
    const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return (lum + 0.05) / 0.0513 > 1.05 / (lum + 0.05) ? "#151515" : "#f5f5f5";
  }

  // The status dot, in the corner: red needs you (a ring around it when it comes back by itself),
  // amber asks for attention (a ring: a session waits for you), green all good, blue asleep.
  const RED = "#ee1d36", AMBER = "#f58a00", GREEN = "#00b84d", BLUE = "#2f7bf5";
  const DOTS = { error: [RED, false], limit: [RED, true], waiting: [AMBER, true], warn: [AMBER, false], ok: [GREEN, false], asleep: [BLUE, false] };

  // The region of the viewBox the canvas shows: the body (12..88) with room for the motion, the
  // dot (84, 84) and the working dots (y 95).
  const VIEW = { x: -6, y: -6, size: 112 };

  const avatars = new Set();
  // The panel draws a new canvas on every update, so the last state of each avatar is kept here:
  // a new canvas in another state starts with the transition from it.
  const seen = new Map();
  const TRANSITION = 0.4; // seconds
  const easeOut = (p) => 1 - (1 - p) ** 5; // exponential-like ease-out, no overshoot
  const progress = (since, now) => (since === undefined || reduced.matches ? 1 : Math.min(1, (now - since) / TRANSITION));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let running = false;

  function mount(canvas, { who, color, state, working = false, size = 52 }) {
    const a = { canvas, ctx: canvas.getContext("2d"), def: defFor(who), who, color: who === "dotagents" ? BRAND : color, state, working, size, offset: Math.random() * 10 };
    a.body = new Path2D(a.def.body);
    const now = performance.now() / 1000, prev = seen.get(who);
    if (prev && prev.state !== state) Object.assign(a, { from: prev.state, since: now });
    if (prev && prev.working !== working) a.workSince = now;
    seen.set(who, { state, working });
    a.ink = inkFor(who, a.color);
    canvas.width = canvas.height = Math.round(size * (devicePixelRatio || 1));
    canvas.style.width = canvas.style.height = `${size}px`;
    avatars.add(a);
    paint(a, now);
    if (!running && !reduced.matches) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  function loop(ms) {
    for (const a of avatars) {
      if (!a.canvas.isConnected) avatars.delete(a);
      // Painted only while it shows: not while the window or the accounts tab is hidden.
      else if (!document.hidden && a.canvas.offsetParent !== null) paint(a, ms / 1000);
    }
    if (avatars.size && !reduced.matches) requestAnimationFrame(loop);
    else running = false;
  }

  // One eye, centered on (cx, cy); lid is how open it is now, 1 open and near 0 in a blink.
  // The states whose eyes are drawn glyphs (an x, a chevron, a dash), not the round or pill eyes.
  const GLYPH_STATES = new Set(["error", "limit", "asleep"]);

  function eyeGlyph(ctx, a, s, cx, cy, left, lid) {
    ctx.fillStyle = ctx.strokeStyle = a.ink;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    const brand = a.who === "dotagents";
    // The pill of an account's eyes.
    const w = 5.8 * a.def.eyes.scale, h = Math.max(1.2, 15.95 * a.def.eyes.scale * lid);
    if (s === "error") {
      ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke();
    } else if (s === "limit") {
      ctx.beginPath(); ctx.moveTo(cx + (left ? -4 : 4), cy - 7); ctx.lineTo(cx + (left ? 5 : -5), cy); ctx.lineTo(cx + (left ? -4 : 4), cy + 7); ctx.stroke();
    } else if (s === "asleep") {
      ctx.beginPath(); ctx.roundRect(cx - 6, cy - 2.2, 12, 4.4, 2.2); ctx.fill();
    } else if (brand || s === "waiting") {
      // The brand's round `..`, and the round eyes of waiting; both blink.
      const r = s === "waiting" ? 7.5 : 7;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, Math.max(0.6, r * lid), 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) / 2); ctx.fill();
    }
    if (s === "warn") {
      // Worried brows, inner end up.
      const top = cy - (brand ? 7 : (15.95 * a.def.eyes.scale) / 2) - 4;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      if (left) { ctx.moveTo(cx - 6, top + 1); ctx.lineTo(cx + 5, top - 4); } else { ctx.moveTo(cx + 6, top + 1); ctx.lineTo(cx - 5, top - 4); }
      ctx.stroke();
    }
  }

  // The status dot of a state, at the corner, scaled around its center (0 is gone).
  function statusDot(ctx, s, scale) {
    const dot = DOTS[s];
    if (!dot || scale <= 0) return;
    const [color, ring] = dot;
    ctx.save();
    ctx.transform(scale, 0, 0, scale, 84 - 84 * scale, 84 - 84 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(84, 84, ring ? 12 : 11.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    if (ring) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(84, 84, 9.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(84, 84, 5.2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(84, 84, 10, 0, Math.PI * 2); ctx.fill();
      if (s === "asleep") {
        ctx.fillStyle = "#ffffff";
        ctx.fill(new Path2D("M87.5 78.8A5.6 5.6 0 1 0 89.2 87.2A4.4 4.4 0 0 1 87.5 78.8Z"));
      }
    }
    ctx.restore();
  }

  function paint(a, seconds) {
    const t = seconds + a.offset;
    const ctx = a.ctx;
    const k = a.canvas.width / VIEW.size;
    // Where the transitions are: p for the state, w for working (0 not working, 1 working).
    const p = progress(a.since, seconds);
    const wp = progress(a.workSince, seconds);
    const w = a.working ? easeOut(wp) : 1 - easeOut(wp);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
    ctx.setTransform(k, 0, 0, k, -VIEW.x * k, -VIEW.y * k);
    ctx.save();
    // A session at work: the body hops twice a loop of 3 s and squashes a little where it lands.
    if (w > 0) {
      const hop = Math.abs(Math.sin((t / 3) * Math.PI * 2)) * w;
      const sy = hop < 0.15 * w && a.working ? 0.93 : 1, sx = sy < 1 ? 1.05 : 1;
      ctx.transform(sx, 0, 0, sy, 50 - 50 * sx, 92 - 92 * sy - 6 * hop);
    }
    ctx.fillStyle = a.color;
    ctx.fill(a.body);
    // The eyes: during a transition, the old ones close in the first half and the new ones open
    // in the second; otherwise a blink every 4 s, closing and opening in 0.2 s.
    const changing = p < 1;
    const s = changing && p < 0.5 ? a.from : a.state;
    const b = t % 4;
    const lid = changing ? Math.max(0.05, Math.abs(1 - 2 * p)) : reduced.matches || b > 0.2 ? 1 : Math.abs(b - 0.1) / 0.1;
    // Waiting looks at you: the eyes sit a little lower.
    const { y, spacing } = a.def.eyes, cy = y + (s === "waiting" ? 1.5 : 0);
    for (const left of [true, false]) {
      const cx = 50 + (left ? -spacing / 2 : spacing / 2);
      ctx.save();
      // The round eyes and the pills close with lid themselves; the drawn glyphs are squeezed.
      if (lid < 1 && GLYPH_STATES.has(s)) ctx.transform(1, 0, 0, lid, 0, cy - cy * lid);
      eyeGlyph(ctx, a, s, cx, cy, left, lid);
      ctx.restore();
    }
    ctx.restore();
    if (w > 0) {
      const lit = Math.floor((t / 3) * 6) % 3;
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = (i === lit ? 1 : 0.3) * w;
        ctx.fillStyle = a.who === "dotagents" ? "#8f8f8f" : a.color;
        ctx.beginPath(); ctx.arc(38 + i * 12, 95, 4.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // The dot: the old one shrinks away in the first half, the new one pops in the second.
    if (changing && p < 0.5) statusDot(ctx, a.from, 1 - easeOut(p * 2));
    else statusDot(ctx, a.state, changing ? easeOut((p - 0.5) * 2) : 1);
  }

  window.dotagentsAvatar = { mount };
})();
