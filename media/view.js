(function () {
  const vscode = acquireVsCodeApi();
  const settings = window.OPENCODE_SETTINGS;
  const css = getComputedStyle(document.documentElement);
  const color = (name, fallback) => css.getPropertyValue(`--vscode-${name}`).trim() || fallback;

  const background = color("sideBar-background", color("terminal-background", "#1e1e1e"));
  const ansiNames = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
  const xtermDefaults = [
    "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
    "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5",
  ];

  const theme = {
    background,
    foreground: color("terminal-foreground", color("sideBar-foreground", "#cccccc")),
    cursor: color("terminalCursor-foreground", undefined),
    selectionBackground: color("terminal-selectionBackground", undefined),
  };
  ansiNames.forEach((name, i) => {
    theme[name.toLowerCase()] = color(`terminal-ansi${name}`, xtermDefaults[i]);
    theme[`bright${name}`] = color(`terminal-ansiBright${name}`, xtermDefaults[i + 8]);
  });

  // The 256-color palette: theme ANSI colors, then the 6x6x6 cube, then the gray ramp
  const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const palette = [
    ...ansiNames.map((n) => theme[n.toLowerCase()]),
    ...ansiNames.map((n) => theme[`bright${n}`]),
  ];
  const levels = [0, 95, 135, 175, 215, 255];
  for (let i = 0; i < 216; i++) {
    palette.push(hex(levels[Math.floor(i / 36)], levels[Math.floor(i / 6) % 6], levels[i % 6]));
  }
  for (let i = 0; i < 24; i++) palette.push(hex(8 + i * 10, 8 + i * 10, 8 + i * 10));

  const el = document.getElementById("terminal");
  el.style.background = background;

  const term = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme,
    allowProposedApi: true,
    scrollback: 0, // opencode is a full-screen app; no scrollback also means no scrollbar gutter
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);

  // WebGL draws cell backgrounds edge to edge; the DOM renderer leaves hairline gaps between
  // rows at fractional zoom levels
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // no WebGL: xterm keeps its DOM renderer
  }

  // Paint the margin around the grid with the color the app paints its first cell, so the
  // terminal has no frame whatever background opencode's theme uses
  function edgeColor() {
    const buffer = term.buffer.active;
    const cell = buffer.getLine(buffer.viewportY)?.getCell(0);
    if (!cell) return background;
    if (cell.isInverse()) return cell.isFgRGB() ? hex(...rgb(cell.getFgColor())) : theme.foreground;
    if (cell.isBgRGB()) return hex(...rgb(cell.getBgColor()));
    if (cell.isBgPalette()) return palette[cell.getBgColor()] || background;
    return background;
  }
  let painting = false;
  term.onRender(() => {
    if (painting) return;
    painting = true;
    requestAnimationFrame(() => {
      painting = false;
      el.style.background = edgeColor();
    });
  });

  // Ctrl+C copies when there is a selection; otherwise it goes to opencode
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown" && event.ctrlKey && event.key === "c" && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    return true;
  });
  term.onData((data) => vscode.postMessage({ type: "input", data }));

  // Fit the terminal to the view, then center the grid in the pixels the cells leave over
  let last = "";
  function layout() {
    if (el.clientWidth === 0 || el.clientHeight === 0) return; // view hidden; keep the last size
    try {
      fit.fit();
    } catch {
      return;
    }
    const xterm = el.querySelector(".xterm");
    const screen = el.querySelector(".xterm-screen");
    if (xterm && screen) {
      const box = getComputedStyle(el);
      const left = Math.max(0, Math.floor((parseFloat(box.width) - screen.offsetWidth) / 2));
      const top = Math.max(0, Math.floor((parseFloat(box.height) - screen.offsetHeight) / 2));
      xterm.style.transform = `translate(${left}px, ${top}px)`;
    }
    const key = `${term.cols}x${term.rows}`;
    if (key !== last) {
      last = key;
      vscode.postMessage({ type: "resize", cols: term.cols, rows: term.rows });
    }
  }
  new ResizeObserver(layout).observe(el);

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "output") term.write(msg.data);
    else if (msg.type === "clear") term.reset();
  });
  window.addEventListener("focus", () => term.focus());

  document.fonts.ready.then(() => {
    layout();
    last = `${term.cols}x${term.rows}`;
    vscode.postMessage({ type: "ready", cols: term.cols, rows: term.rows });
    term.focus();
  });
})();
