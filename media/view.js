(function () {
  const vscode = acquireVsCodeApi();
  const settings = window.AGENTS_SETTINGS;
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

  const panes = document.getElementById("panes");
  const list = document.getElementById("list");
  const terminals = new Map(); // session id -> { el, term, fit, last }
  let state = { sessions: [], active: null };

  // One terminal per session. It stays alive while hidden, so switching back is instant
  function open(session) {
    const provider = settings.providers[session.provider];
    const el = document.createElement("div");
    el.className = "pane";
    panes.appendChild(el);

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      letterSpacing: settings.letterSpacing,
      fontWeight: settings.fontWeight,
      fontWeightBold: settings.fontWeightBold,
      minimumContrastRatio: settings.minimumContrastRatio,
      customGlyphs: true, // box drawing and block characters drawn to fill the cell, as in VS Code
      theme,
      allowProposedApi: true,
      // Full-screen agents get none, which also means no scrollbar gutter
      scrollback: provider.scrollback ? settings.scrollback : 0,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    // Webviews can't open links themselves; the extension opens them in the browser
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_event, uri) => vscode.postMessage({ type: "open", uri })));
    term.open(el);

    // WebGL by default: it draws block and box characters to fill the cell exactly, where the DOM
    // renderer leaves hairlines between rows. Falls back to DOM without WebGL
    if (settings.renderer !== "dom") {
      try {
        const webgl = new WebglAddon.WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // no WebGL: xterm keeps its DOM renderer
      }
    }

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      // Ctrl+C copies when there is a selection; otherwise it goes to the agent
      if (event.ctrlKey && event.key.toLowerCase() === "c" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      // Shift+Enter inserts a newline, sent as the sequence the agent reads as one
      if (provider.newline && event.shiftKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
        event.preventDefault();
        vscode.postMessage({ type: "input", id: session.id, data: provider.newline });
        return false;
      }
      return true;
    });
    term.onData((data) => vscode.postMessage({ type: "input", id: session.id, data }));
    // Typing in a pane of a split makes its session the active one
    el.addEventListener("focusin", () => {
      if (state.active !== session.id) vscode.postMessage({ type: "activate", id: session.id });
    });

    const terminal = { el, term, fit, last: "" };
    new ResizeObserver(() => layout(session.id, terminal)).observe(el);
    return terminal;
  }

  // Fit the terminal to its pane, then center the grid in the pixels the cells leave over
  function layout(id, terminal) {
    const { el, term, fit } = terminal;
    if (el.clientWidth === 0 || el.clientHeight === 0) return; // hidden; keep the last size
    try {
      fit.fit();
    } catch {
      return;
    }
    const xterm = el.querySelector(".xterm");
    const screen = el.querySelector(".xterm-screen");
    if (xterm && screen) {
      // Center the grid, then snap it to whole device pixels: at fractional scales (125%,
      // zoomed windows) a grid on a half pixel gets resampled by the browser and looks blurry
      xterm.style.transform = "none";
      const dpr = window.devicePixelRatio || 1;
      const box = getComputedStyle(el);
      const area = el.getBoundingClientRect();
      const base = screen.getBoundingClientRect();
      const snap = (v) => Math.round(v * dpr) / dpr;
      const left = area.left + parseFloat(box.paddingLeft) + Math.max(0, (parseFloat(box.width) - base.width) / 2);
      const top = area.top + parseFloat(box.paddingTop) + Math.max(0, (parseFloat(box.height) - base.height) / 2);
      xterm.style.transform = `translate(${snap(left) - base.left}px, ${snap(top) - base.top}px)`;
    }
    const key = `${term.cols}x${term.rows}`;
    if (key !== terminal.last) {
      terminal.last = key;
      vscode.postMessage({ type: "resize", id, cols: term.cols, rows: term.rows });
    }
  }

  function layoutAll() {
    // A split goes side by side in a wide view and stacks in a tall one
    panes.classList.toggle("row", panes.clientWidth >= panes.clientHeight);
    for (const [id, terminal] of terminals) layout(id, terminal);
  }

  function item(session) {
    const provider = settings.providers[session.provider];
    const el = document.createElement("div");
    el.className = "item";
    el.classList.toggle("active", session.id === state.active);
    el.classList.toggle("grouped", state.sessions.filter((s) => s.group === session.group).length > 1);
    el.title = session.name === provider.name ? provider.name : `${session.name} (${provider.name})`;
    // The session's commands, in VS Code's own context menu
    el.dataset.vscodeContext = JSON.stringify({
      webviewSection: "session",
      sessionId: session.id,
      preventDefaultContextMenuItems: true,
    });
    el.addEventListener("click", () => vscode.postMessage({ type: "activate", id: session.id }));

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.style.maskImage = `url("${provider.icon}")`;
    icon.style.backgroundColor = theme[session.color] || theme.foreground;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = session.name;
    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "×";
    close.title = "Close session";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: "close", id: session.id });
    });
    el.append(icon, name, close);
    return el;
  }

  // Draw the state: a terminal per session, the active group's panes, the list
  function render() {
    for (const [id, terminal] of terminals) {
      if (state.sessions.some((s) => s.id === id)) continue;
      terminal.term.dispose();
      terminal.el.remove();
      terminals.delete(id);
    }
    const active = state.sessions.find((s) => s.id === state.active);
    for (const session of state.sessions) {
      if (!terminals.has(session.id)) terminals.set(session.id, open(session));
      const { el } = terminals.get(session.id);
      el.classList.toggle("hidden", !active || session.group !== active.group);
      panes.appendChild(el); // the panes follow the order of the list
    }
    panes.classList.toggle("empty", !state.sessions.length);
    list.replaceChildren(...state.sessions.map(item));
    layoutAll();
    focus();
  }

  function focus() {
    const terminal = terminals.get(state.active);
    if (terminal && !terminal.el.contains(document.activeElement)) terminal.term.focus();
  }

  new ResizeObserver(layoutAll).observe(panes);

  // Zooming the window changes the device pixel ratio without resizing in CSS pixels
  function watchScale() {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        layoutAll();
        watchScale();
      },
      { once: true }
    );
  }
  watchScale();

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "init") {
      state = msg.state;
      render();
      for (const [id, screen] of Object.entries(msg.screens)) terminals.get(id)?.term.write(screen);
    } else if (msg.type === "state") {
      state = msg.state;
      render();
    } else if (msg.type === "output") terminals.get(msg.id)?.term.write(msg.data);
    else if (msg.type === "clear") terminals.get(msg.id)?.term.reset();
  });
  window.addEventListener("focus", focus);

  document.fonts.ready.then(() => vscode.postMessage({ type: "ready" }));
})();
