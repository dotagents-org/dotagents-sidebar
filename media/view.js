(function () {
  const vscode = acquireVsCodeApi();
  const settings = window.DOTAGENTS_SIDEBAR_SETTINGS;
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

  const header = document.getElementById("header");
  const panes = document.getElementById("panes");
  const list = document.getElementById("list");
  const terminals = new Map(); // session id -> { el, term, fit, last }
  let state = { sessions: [], active: null };

  // The keys VS Code keeps while a session has focus, worked out by the extension (media/keys.js);
  // the built-in list until it has
  let vsCodeKeys = new Set(settings.keys || agentKeys.FALLBACK);
  const forVsCode = (event) => vsCodeKeys.has(agentKeys.eventCombo(event));

  // File links (media/links.js finds the paths; the extension says which exist and opens them).
  // A request per hovered line, answered by id; the answers are cached there for a few seconds
  const linkRequests = new Map();
  let nextLinkRequest = 0;
  function existing(sessionId, paths) {
    return new Promise((resolve) => {
      const id = ++nextLinkRequest;
      linkRequests.set(id, resolve);
      vscode.postMessage({ type: "links", id, session: sessionId, paths });
      setTimeout(() => linkRequests.delete(id) && resolve({}), 3000);
    });
  }
  // The text of the line at y and the lines wrapped onto it, with where each character sits on the
  // screen (a wide character takes two cells, its second one has no character)
  function wrappedLine(term, y) {
    const buffer = term.buffer.active;
    let first = y;
    while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
    let last = y;
    while (buffer.getLine(last + 1)?.isWrapped) last++;
    let text = "";
    const cells = [];
    for (let row = first; row <= last; row++) {
      const line = buffer.getLine(row);
      if (!line) break;
      for (let x = 0; x < term.cols; x++) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        for (let i = 0; i < chars.length; i++) cells.push({ x: x + 1, y: row + 1, width: cell.getWidth() });
        text += chars;
      }
    }
    const end = text.trimEnd().length;
    return { text: text.slice(0, end), cells: cells.slice(0, end) };
  }
  function linkProvider(term, session) {
    return {
      provideLinks(y, callback) {
        const { text, cells } = wrappedLine(term, y - 1);
        const found = agentLinks.findPaths(text);
        if (!found.length) return callback(undefined);
        existing(session.id, [...new Set(found.map((f) => f.path))]).then((files) => {
          const links = found
            .filter((f) => files[f.path])
            .map((f) => {
              const from = cells[f.start];
              const to = cells[f.end - 1];
              return {
                range: { start: { x: from.x, y: from.y }, end: { x: to.x + to.width - 1, y: to.y } },
                text: text.slice(f.start, f.end),
                decorations: { pointerCursor: true, underline: true },
                // Ctrl+click (Cmd+click on a Mac), as in the integrated terminal
                activate: (event) => {
                  if (!event.ctrlKey && !event.metaKey) return;
                  vscode.postMessage({ type: "openFile", file: files[f.path], line: f.line, column: f.column });
                },
              };
            })
            .filter((link) => link.range.start.y <= y && link.range.end.y >= y);
          callback(links.length ? links : undefined);
        });
      },
    };
  }

  // The dotagents accounts panel, a fixed tab first in the list, when that extension is installed:
  // its scripts load the first time the tab opens, into #accounts. A webview gets one acquireVsCodeApi, so the
  // panel gets this page's, its messages marked as the accounts'; the answers come back as they are
  // (usage, result, down), types this page doesn't use.
  const accounts = settings.accounts;
  const accountsPane = document.getElementById("accounts");
  let showAccounts = false;
  window.acquireVsCodeApi = () => ({ postMessage: (message) => vscode.postMessage({ type: "accounts", message }) });
  let accountsLoaded = false;
  function loadAccounts() {
    if (accountsLoaded) return;
    accountsLoaded = true;
    for (const src of accounts.scripts) {
      const script = document.createElement("script");
      script.nonce = accounts.nonce;
      script.async = false; // in order: the avatars, then the panel
      script.src = src;
      document.body.append(script);
    }
  }

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
    // Links an agent marks itself (OSC 8): web pages in the browser, files in the editor
    term.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate: (_event, uri) => {
        if (/^https?:\/\//i.test(uri)) vscode.postMessage({ type: "open", uri });
        else if (/^file:\/\//i.test(uri)) {
          const m = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(decodeURIComponent(uri.replace(/^file:\/\//i, "")));
          vscode.postMessage({ type: "openFile", file: m[1], line: m[2] && Number(m[2]), column: m[3] && Number(m[3]), check: true });
        }
      },
    };
    term.open(el);
    term.registerLinkProvider(linkProvider(term, session));

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
      // A key left to VS Code is not handled here: it bubbles out of the page, and VS Code runs
      // its shortcut, as the integrated terminal does for terminal.integrated.commandsToSkipShell
      if (forVsCode(event)) return false;
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      // Ctrl+C copies when there is a selection, otherwise it goes to the agent; Ctrl+Shift+C copies
      if (event.ctrlKey && key === "c" && (event.shiftKey || term.hasSelection())) {
        copy();
        return false;
      }
      // Ctrl+V and Ctrl+Shift+V paste through the browser's paste event, as the integrated terminal
      // does, without the ^V xterm would send first: on Windows, Claude Code reads it as pasting an
      // image and the text never comes
      if (event.ctrlKey && key === "v") return false;
      // Shift+Enter inserts a newline, sent as the sequence the agent reads as one
      if (provider.newline && event.shiftKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
        event.preventDefault();
        vscode.postMessage({ type: "input", id: session.id, data: provider.newline });
        return false;
      }
      return true;
    });
    term.onData((data) => vscode.postMessage({ type: "input", id: session.id, data }));
    // The selection to the clipboard, cleared as the integrated terminal does
    function copy() {
      if (!term.hasSelection()) return;
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
    }
    // A right click, as terminal.integrated.rightClickBehavior says
    el.addEventListener("contextmenu", (event) => {
      const behavior = settings.rightClickBehavior;
      if (behavior !== "copyPaste" && behavior !== "paste") return;
      event.preventDefault();
      event.stopPropagation();
      if (behavior === "copyPaste" && term.hasSelection()) return copy();
      navigator.clipboard.readText().then((text) => text && term.paste(text), () => {});
    });
    // The agent's window title names its conversation (Claude Code: "✳ fix login"). Without the
    // status mark in front, and only when it says more than the agent's or the workspace's name
    let lastTitle;
    term.onTitleChange((raw) => {
      const clean = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const title = clean === provider.name || clean === settings.workspace ? "" : clean;
      if (title === lastTitle) return; // a spinner changes only the mark
      lastTitle = title;
      vscode.postMessage({ type: "title", id: session.id, title });
    });
    // Typing in a pane of a split makes its session the active one
    el.addEventListener("focusin", () => {
      if (state.active !== session.id) vscode.postMessage({ type: "activate", id: session.id });
    });

    const terminal = { el, term, fit, last: "" };
    new ResizeObserver(resizing).observe(el);
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
    place(terminal);
    const key = `${term.cols}x${term.rows}`;
    if (key !== terminal.last) {
      terminal.last = key;
      vscode.postMessage({ type: "resize", id, cols: term.cols, rows: term.rows });
    }
  }

  function place({ el }) {
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
  }

  function layoutAll() {
    clearTimeout(settle);
    // A split goes side by side in a wide view and stacks in a tall one
    panes.classList.toggle("row", panes.clientWidth >= panes.clientHeight);
    for (const [id, terminal] of terminals) layout(id, terminal);
  }

  // While the view is being resized, the grid keeps its size and only stays centered: every new
  // size makes the agent clear and redraw its whole screen, which flickers during a drag. The
  // grid fits, and the agent redraws, once the size holds still, as in the integrated terminal
  let settle;
  function resizing() {
    for (const terminal of terminals.values()) place(terminal);
    clearTimeout(settle);
    settle = setTimeout(layoutAll, 100);
  }

  function item(session) {
    const provider = settings.providers[session.provider];
    const el = document.createElement("div");
    el.className = "item";
    el.classList.toggle("active", !showAccounts && session.id === state.active);
    el.classList.toggle("grouped", state.sessions.filter((s) => s.group === session.group).length > 1);
    const name = label(session);
    el.title = name ? `${name} (${provider.name})` : provider.name;
    // The session's commands, in VS Code's own context menu
    el.dataset.vscodeContext = JSON.stringify({
      webviewSection: "session",
      sessionId: session.id,
      preventDefaultContextMenuItems: true,
    });
    el.addEventListener("click", () => {
      if (showAccounts) {
        showAccounts = false;
        render();
      }
      vscode.postMessage({ type: "activate", id: session.id });
    });

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.style.maskImage = `url("${provider.icon}")`;
    icon.style.backgroundColor = theme[session.color] || theme.foreground;
    el.append(icon);
    return el;
  }

  // The session's name: the one given in the list, else the conversation's title from the agent
  function label(session) {
    const provider = settings.providers[session.provider];
    return session.name !== provider.name ? session.name : session.title || "";
  }

  // The active session, like a terminal tab: the agent's mark in the session's color, the workspace
  // (dimmer) and the session's own name, when it has one other than the agent's. The agent's name is
  // the view's title.
  // The accounts tab has no title: the panel starts with its own seal.
  function title(session) {
    header.classList.toggle("hidden", showAccounts);
    if (showAccounts) return header.replaceChildren();
    if (!session) return header.replaceChildren();
    const provider = settings.providers[session.provider];
    const part = (cls, text) => {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = text;
      return el;
    };
    const icon = part("icon", "");
    icon.style.maskImage = `url("${provider.icon}")`;
    icon.style.backgroundColor = theme[session.color] || theme.foreground;
    const parts = [icon];
    if (settings.workspace) parts.push(part("workspace", settings.workspace));
    const name = label(session);
    if (name) parts.push(part("slash", "/"), part("session", name));
    header.replaceChildren(...parts);
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
      el.classList.toggle("hidden", showAccounts || !active || session.group !== active.group);
      panes.appendChild(el); // the panes follow the order of the list
    }
    accountsPane?.classList.toggle("hidden", !showAccounts);
    if (showAccounts) loadAccounts();
    panes.classList.toggle("empty", !showAccounts && !state.sessions.length);
    list.replaceChildren(...(accounts ? [accountsItem()] : []), ...state.sessions.map(item));
    title(active);
    viewTitle(active);
    layoutAll();
    focus();
  }

  // The view's title follows the tab: "Accounts" on the accounts tab, the active session's agent on
  // a session, "Sidebar" (the manifest's name) with neither
  let shownTitle = null; // unknown until the first draw, so a reloaded page sets it again
  function viewTitle(session) {
    const text = showAccounts ? "Accounts" : session ? settings.providers[session.provider].name : "Sidebar";
    if (text === shownTitle) return;
    shownTitle = text;
    vscode.postMessage({ type: "view", title: text });
  }

  // The accounts tab: the mark, always first, never closed or split
  function accountsItem() {
    const el = document.createElement("div");
    el.className = "item fixed";
    el.classList.toggle("active", showAccounts);
    el.title = "Accounts";
    el.addEventListener("click", () => {
      showAccounts = true;
      render();
    });
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.style.maskImage = `url("${accounts.icon}")`;
    icon.style.backgroundColor = theme.foreground;
    el.append(icon);
    return el;
  }

  function focus() {
    if (showAccounts) return;
    const terminal = terminals.get(state.active);
    if (terminal && !terminal.el.contains(document.activeElement)) terminal.term.focus();
  }

  new ResizeObserver(resizing).observe(panes);

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
      showAccounts = !!accounts && !state.sessions.length; // with no session yet, the accounts
      render();
      for (const [id, screen] of Object.entries(msg.screens)) terminals.get(id)?.term.write(screen);
    } else if (msg.type === "state") {
      // Another session made active (a click, a new one) leaves the accounts tab
      if (msg.state.active !== state.active) showAccounts = false;
      state = msg.state;
      render();
    } else if (msg.type === "output") terminals.get(msg.id)?.term.write(msg.data);
    else if (msg.type === "links" && linkRequests.has(msg.id)) {
      linkRequests.get(msg.id)(msg.files || {});
      linkRequests.delete(msg.id);
    }
    else if (msg.type === "clear") terminals.get(msg.id)?.term.reset();
    else if (msg.type === "keys") vsCodeKeys = new Set(msg.keys);
  });
  window.addEventListener("focus", focus);

  // The theme's colors, so the color picker can show each one as it looks here
  vscode.postMessage({ type: "palette", colors: Object.fromEntries(ansiNames.map((n) => [n.toLowerCase(), theme[n.toLowerCase()]])) });
  document.fonts.ready.then(() => vscode.postMessage({ type: "ready" }));
})();
