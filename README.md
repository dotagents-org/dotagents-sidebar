# opencode Sidebar

A small VS Code extension that runs the [opencode](https://opencode.ai) terminal UI inside its own view in the **secondary sidebar**, next to Claude Code and Codex.

The official opencode extension opens opencode in a terminal tab. This one gives it a sidebar icon instead: click it and opencode is right there in the view, the same TUI you get in a terminal. You don't have to switch to the terminal panel or hunt for a tab.

> This is an unofficial community project. It is not affiliated with or endorsed by the opencode team.

## Features

- **Sidebar view.** An opencode icon sits in the secondary sidebar. The view runs a full terminal ([xterm.js](https://xtermjs.org)) with opencode inside, fitted to the view and resized when you drag the sidebar.
- **Several sessions.** Hover the view and click **+** at the top right to start another opencode. With more than one, a tab bar appears: click a tab to switch, and click **×** or middle-click it to close. Each tab is its own opencode process, so they can work at the same time.
- **Persistent sessions.** Switch to another view and back, and every opencode keeps running. When one exits, press <kbd>Enter</kbd> in its tab to start it again.
- **Blends into the sidebar.** The terminal takes the sidebar's background, so there is no frame around it, and the grid is centered in the view. It uses your `terminal.integrated.fontFamily`, `fontSize` and `lineHeight` (falling back to the editor's) and your theme's ANSI colors.
- **Clipboard.** <kbd>Ctrl</kbd>+<kbd>C</kbd> copies when text is selected and goes to opencode otherwise. <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes.
- **Terminal profile.** An **opencode** entry in the terminal's new-terminal menu (⌄ next to `+`) opens opencode in a regular terminal, with the opencode mark as its tab icon.
- **Remote ready.** It runs where your workspace runs, so it works in WSL, SSH and dev containers as well as locally.

## Requirements

- VS Code **1.106** or newer (the first version with the `secondarySidebar` view container).
- [opencode](https://opencode.ai) installed on the machine where your workspace runs:
  - **Linux, macOS, WSL, remote:** opencode is started with `bash -ic opencode`, so it must be on the `PATH` set up by your `~/.bashrc` (the opencode installer adds it there).
  - **Windows:** opencode is started with `powershell.exe -NoLogo -Command opencode`, so `opencode` must run from PowerShell.

## Install

The extension is not on the Marketplace. Install the `.vsix` from a release:

1. Download `opencode-sidebar.vsix` from the [latest release](https://github.com/gabrieldulolmarques/opencode-sidebar/releases/latest).
2. In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**, then pick the file.
   Or, from a terminal: `code --install-extension opencode-sidebar.vsix`.
3. Run **Developer: Reload Window**.

In a remote window (WSL, SSH, containers), install it while connected, so it lands on the remote side where opencode runs.

## Usage

Click the opencode icon in the secondary sidebar. opencode starts in the first workspace folder (or your home folder when no folder is open).

If the icon doesn't show up, open the secondary sidebar with **View: Toggle Secondary Side Bar Visibility**. You can drag the icon to any other sidebar or panel; VS Code remembers where you put it.

### Commands

| Command | What it does |
|---|---|
| `opencode: New Session` | Starts another opencode in a new tab |
| `opencode: Restart Session` | Stops the opencode in the active tab and starts a fresh one |
| `opencode: Open in Terminal Panel` | Opens opencode in a regular terminal instead |

## How it works

VS Code's API only lets extensions put terminals in the terminal panel or the editor area, not in a sidebar. So the view is a webview that draws its own terminal with xterm.js. The opencode process runs on the extension host through **node-pty**: the copy that ships inside VS Code itself, loaded from `vscode.env.appRoot`. Keystrokes go from the webview to the process, and output comes back the other way. Each tab has its own process and its own xterm.js instance; only the active one is shown, and the hidden ones follow its size.

Because the view is a webview, `retainContextWhenHidden` keeps it alive while hidden. The extension also keeps the last 512 KB of output per session to redraw the view if VS Code rebuilds it (for example after you move it to another sidebar).

## Known limitations

- **VS Code internals.** node-pty is not a public API. If a VS Code update moves it, the view shows an error listing the paths it tried. Please [open an issue](https://github.com/gabrieldulolmarques/opencode-sidebar/issues) if that happens.
- **Keybindings.** Like any webview, the view lets some VS Code shortcuts through (for example <kbd>Ctrl</kbd>+<kbd>P</kbd>), so those keys reach VS Code, not opencode.
- **Shell startup output.** Anything your `~/.bashrc` prints shows up for a moment before opencode takes over the screen.

## Development

There is no build step: the extension is plain JavaScript.

```bash
git clone https://github.com/gabrieldulolmarques/opencode-sidebar.git
cd opencode-sidebar
npm install # xterm.js and its fit addon
npm run package # writes opencode-sidebar.vsix
code --install-extension opencode-sidebar.vsix --force
```

Then reload the VS Code window. To debug, open the folder in VS Code and press <kbd>F5</kbd> to start an Extension Development Host.

| File | Role |
|---|---|
| `extension.js` | Extension host: the webview provider, the sessions and their node-pty processes, commands and terminal profile |
| `media/view.js` | Webview: tabs, one xterm.js per session, theme colors, fitting and centering, clipboard |
| `media/view.css` | Webview layout and tab bar |
| `media/opencode*.svg` | Sidebar and terminal tab icons |

## Credits

- [opencode](https://github.com/anomalyco/opencode) (MIT). The icons are drawn from the opencode mark in its official VS Code extension. opencode's name and mark belong to their owners.
- [xterm.js](https://github.com/xtermjs/xterm.js) and [node-pty](https://github.com/microsoft/node-pty) (MIT).

## License

[MIT](LICENSE)
