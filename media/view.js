(function () {
  const vscode = acquireVsCodeApi();
  const settings = window.OPENCODE_SETTINGS;
  const css = getComputedStyle(document.documentElement);
  const color = (name, fallback) => css.getPropertyValue(`--vscode-${name}`).trim() || fallback;

  // Use the sidebar's own background, so the terminal blends into the view with no frame
  const background = color("sideBar-background", color("terminal-background", "#1e1e1e"));
  document.documentElement.style.setProperty("--opencode-background", background);

  const theme = {
    background,
    foreground: color("terminal-foreground", color("sideBar-foreground", "#cccccc")),
    cursor: color("terminalCursor-foreground", undefined),
    selectionBackground: color("terminal-selectionBackground", undefined),
  };
  for (const name of ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"]) {
    theme[name.toLowerCase()] = color(`terminal-ansi${name}`, undefined);
    theme[`bright${name}`] = color(`terminal-ansiBright${name}`, undefined);
  }

  const options = {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme,
    allowProposedApi: true,
    scrollback: 0, // opencode is a full-screen app; no scrollback also means no scrollbar gutter
  };

  const tabList = document.getElementById("tab-list");
  const container = document.getElementById("terminals");
  const sessions = new Map(); // id -> { term, fit, el, tab }
  let active;
  let size = { cols: 80, rows: 24 };

  function createTerminal(id, number) {
    const el = document.createElement("div");
    el.className = "session";
    container.appendChild(el);

    const term = new Terminal(options);
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.resize(size.cols, size.rows);

    // Ctrl+C copies when there is a selection; otherwise it goes to opencode
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.key === "c" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      return true;
    });
    term.onData((data) => vscode.postMessage({ type: "input", id, data }));

    const tab = document.createElement("div");
    tab.className = "tab";
    tab.setAttribute("role", "tab");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `opencode ${number}`;
    const close = document.createElement("button");
    close.className = "close";
    close.title = "Close session";
    close.setAttribute("aria-label", "Close session");
    close.textContent = "×";
    tab.append(label, close);
    tabList.appendChild(tab);

    tab.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault(); // keep middle click from autoscrolling
    });
    tab.addEventListener("click", () => activate(id, true));
    tab.addEventListener("auxclick", (event) => {
      if (event.button === 1) vscode.postMessage({ type: "close", id });
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: "close", id });
    });
    term.onTitleChange((title) => {
      const clean = title.trim();
      label.textContent = clean && clean !== "opencode" ? clean : `opencode ${number}`;
      tab.title = label.textContent;
    });

    sessions.set(id, { term, fit, el, tab });
    document.body.classList.toggle("multi", sessions.size > 1);
  }

  function removeTerminal(id) {
    const s = sessions.get(id);
    if (!s) return;
    s.term.dispose();
    s.el.remove();
    s.tab.remove();
    sessions.delete(id);
    document.body.classList.toggle("multi", sessions.size > 1);
    if (active === id) {
      active = undefined;
      const last = [...sessions.keys()].pop();
      if (last !== undefined) activate(last, true);
    } else {
      layoutActive();
    }
  }

  function activate(id, notify) {
    const s = sessions.get(id);
    if (!s) return;
    active = id;
    for (const [otherId, other] of sessions) {
      const on = otherId === id;
      other.el.classList.toggle("active", on);
      other.tab.classList.toggle("active", on);
      other.tab.setAttribute("aria-selected", String(on));
    }
    layout(s);
    s.term.focus();
    if (notify) vscode.postMessage({ type: "activate", id });
  }

  function layoutActive() {
    const s = sessions.get(active);
    if (s) layout(s);
  }

  // Fit the terminal to the view, then center the grid in the pixels the cells leave over
  function layout(s) {
    if (s.el.clientWidth === 0 || s.el.clientHeight === 0) return; // view hidden; keep the last size
    try {
      s.fit.fit();
    } catch {
      return;
    }
    const xterm = s.el.querySelector(".xterm");
    const screen = s.el.querySelector(".xterm-screen");
    if (xterm && screen) {
      const left = Math.max(0, Math.floor((s.el.clientWidth - screen.offsetWidth) / 2));
      const top = Math.max(0, Math.floor((s.el.clientHeight - screen.offsetHeight) / 2));
      xterm.style.transform = `translate(${left}px, ${top}px)`;
    }
    if (s.term.cols !== size.cols || s.term.rows !== size.rows) {
      size = { cols: s.term.cols, rows: s.term.rows };
      vscode.postMessage({ type: "resize", ...size });
    }
    // Hidden sessions can't measure themselves; they follow the active one
    for (const other of sessions.values()) {
      if (other !== s && (other.term.cols !== size.cols || other.term.rows !== size.rows)) {
        other.term.resize(size.cols, size.rows);
      }
    }
  }

  new ResizeObserver(layoutActive).observe(container);

  document.getElementById("new").addEventListener("click", () => vscode.postMessage({ type: "create" }));

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        for (const id of [...sessions.keys()]) removeTerminal(id);
        for (const s of msg.sessions) createTerminal(s.id, s.number);
        activate(msg.active ?? msg.sessions[msg.sessions.length - 1]?.id, false);
        break;
      case "add":
        createTerminal(msg.session.id, msg.session.number);
        activate(msg.session.id, false);
        break;
      case "remove":
        removeTerminal(msg.id);
        break;
      case "output":
        sessions.get(msg.id)?.term.write(msg.data);
        break;
      case "clear":
        sessions.get(msg.id)?.term.reset();
        break;
    }
  });
  window.addEventListener("focus", () => sessions.get(active)?.term.focus());

  // Measure the grid with a throwaway terminal, so the first session starts at the right size
  document.fonts.ready.then(() => {
    const probe = document.createElement("div");
    probe.className = "session active";
    container.appendChild(probe);
    const term = new Terminal(options);
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(probe);
    try {
      fit.fit();
      size = { cols: term.cols, rows: term.rows };
    } catch {}
    term.dispose();
    probe.remove();
    vscode.postMessage({ type: "ready", ...size });
  });
})();
