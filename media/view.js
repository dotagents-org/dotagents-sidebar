(function () {
  const vscode = acquireVsCodeApi();
  const settings = window.OPENCODE_SETTINGS;
  const css = getComputedStyle(document.documentElement);
  const color = (name, fallback) => css.getPropertyValue(`--vscode-${name}`).trim() || fallback;

  const background = color("terminal-background", color("sideBar-background", "#1e1e1e"));
  document.body.style.background = background;

  const ansi = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
  const theme = {
    background,
    foreground: color("terminal-foreground", "#cccccc"),
    cursor: color("terminalCursor-foreground", undefined),
    selectionBackground: color("terminal-selectionBackground", undefined),
  };
  for (const name of ansi) {
    const key = name.toLowerCase();
    theme[key] = color(`terminal-ansi${name}`, undefined);
    theme[`bright${name}`] = color(`terminal-ansiBright${name}`, undefined);
  }

  const term = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme,
    allowProposedApi: true,
    scrollback: 5000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById("terminal"));

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

  let last = "";
  function resize() {
    try {
      fit.fit();
    } catch {
      return;
    }
    const key = `${term.cols}x${term.rows}`;
    if (key !== last) {
      last = key;
      vscode.postMessage({ type: "resize", cols: term.cols, rows: term.rows });
    }
  }
  new ResizeObserver(resize).observe(document.getElementById("terminal"));

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "output") term.write(msg.data);
    else if (msg.type === "clear") term.reset();
  });
  window.addEventListener("focus", () => term.focus());

  document.fonts.ready.then(() => {
    fit.fit();
    last = `${term.cols}x${term.rows}`;
    vscode.postMessage({ type: "ready", cols: term.cols, rows: term.rows });
    term.focus();
  });
})();
