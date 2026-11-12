# OpenCode Sidebar

Run the [OpenCode](https://opencode.ai) terminal UI in VS Code's **secondary sidebar**.

The official OpenCode extension opens OpenCode in a terminal tab. This one gives it a sidebar icon instead: click it and OpenCode is right there in the view, the same TUI you get in a terminal. You don't have to switch to the terminal panel or hunt for a tab.

> This is an unofficial community project. It is not affiliated with or endorsed by the OpenCode team.

## Features

- **Sidebar view.** An OpenCode icon sits in the secondary sidebar. The view runs a full terminal ([xterm.js](https://xtermjs.org)) with OpenCode inside, fitted to the view and resized when you drag the sidebar.
- **Persistent session.** Switch to another view and back, and OpenCode keeps running. When it exits, press <kbd>Enter</kbd> in the view to start it again. For several conversations, use OpenCode's own session tabs (OpenCode 2 and newer).
- **Seamless rendering.** The view draws with xterm.js's WebGL renderer, which fills block and box characters exactly, so OpenCode's panels and logo have no hairlines between rows (the DOM renderer draws them from the font and leaves gaps at fractional zoom levels). Set `opencodeSidebar.renderer` to `dom` to use the DOM renderer instead; without WebGL it falls back to DOM on its own.
- **Your terminal font.** `terminal.integrated.fontFamily`, `fontSize`, `lineHeight`, `letterSpacing`, `fontWeight`, `fontWeightBold` and `minimumContrastRatio` set the text (font settings fall back to the editor's). Changing any of them updates the view without restarting OpenCode.
- **No frame, sharp at any scale.** The margin around the grid takes the background color OpenCode paints, so there is no frame whatever its theme, and any hairline gap between rows shows that same color. The grid is centered and snapped to whole device pixels, so it stays sharp at fractional display scales and zoom levels.
- **Follows your theme.** Switching the color theme recolors the view at once, without restarting OpenCode.
- **Clickable links.** URLs in OpenCode's output open in your browser.
- **Clipboard.** <kbd>Ctrl</kbd>+<kbd>C</kbd> copies when text is selected and goes to OpenCode otherwise. <kbd>Ctrl</kbd>+<kbd>V</kbd> pastes.
- **Terminal profile.** An **OpenCode** entry in the terminal's new-terminal menu (⌄ next to `+`) opens OpenCode in a regular terminal, with the OpenCode mark as its tab icon.
- **Remote ready.** It runs where your workspace runs, so it works in WSL, SSH and dev containers as well as locally.

## Requirements

- VS Code **1.106** or newer (the first version with the `secondarySidebar` view container).
- [OpenCode](https://opencode.ai) installed on the machine where your workspace runs:
  - **Linux, macOS, WSL, remote:** OpenCode is started with `bash -ic opencode`, so it must be on the `PATH` set up by your `~/.bashrc` (the OpenCode installer adds it there).
  - **Windows:** OpenCode is started with `powershell.exe -NoLogo -Command opencode`, so `opencode` must run from PowerShell.

## Install

The extension is not on the Marketplace. Install the `.vsix` from a release:

1. Download `opencode-sidebar.vsix` from the [latest release](https://github.com/gabrieldulolmarques/opencode-sidebar/releases/latest).
2. In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**, then pick the file.
   Or, from a terminal: `code --install-extension opencode-sidebar.vsix`.
3. Run **Developer: Reload Window**.

In a remote window (WSL, SSH, containers), install it while connected, so it lands on the remote side where OpenCode runs.

Since VS Code can't update an extension installed from a `.vsix`, the extension checks GitHub for a newer release once a day and offers to install it (or to skip that version).

## Usage

Click the OpenCode icon in the secondary sidebar. OpenCode starts in the first workspace folder (or your home folder when no folder is open).

If the icon doesn't show up, open the secondary sidebar with **View: Toggle Secondary Side Bar Visibility**. You can drag the icon to any other sidebar or panel; VS Code remembers where you put it.

### Settings

| Setting | Default | What it does |
|---|---|---|
| `opencodeSidebar.renderer` | `webgl` | `webgl` or `dom`: how the view draws the terminal. Independent of `terminal.integrated.gpuAcceleration` |

### Commands

| Command | What it does |
|---|---|
| `OpenCode: Restart` | Stops the OpenCode in the view and starts a fresh one |

It also sits as a button in the view's title bar.

## How it works

VS Code's API only lets extensions put terminals in the terminal panel or the editor area, not in a sidebar. So the view is a webview that draws its own terminal with xterm.js. The OpenCode process runs on the extension host through **node-pty**: the copy that ships inside VS Code itself, loaded from `vscode.env.appRoot`. Keystrokes go from the webview to the process, and output comes back the other way.

Because the view is a webview, `retainContextWhenHidden` keeps it alive while hidden. The extension also keeps a headless copy of the screen ([`@xterm/headless`](https://www.npmjs.com/package/@xterm/headless)) and serializes it to redraw the view exactly when VS Code rebuilds it (for example after you move it to another sidebar or change a setting). OpenCode runs with VS Code's own `ELECTRON_*` and `VSCODE_*` variables removed from its environment, as in the integrated terminal.

## Known limitations

- **VS Code internals.** node-pty is not a public API. If a VS Code update moves it, the view shows an error listing the paths it tried. Please [open an issue](https://github.com/gabrieldulolmarques/opencode-sidebar/issues) if that happens.
- **Keybindings.** Like any webview, the view lets some VS Code shortcuts through (for example <kbd>Ctrl</kbd>+<kbd>P</kbd>), so those keys reach VS Code, not OpenCode.
- **Shell startup output.** Anything your `~/.bashrc` prints shows up for a moment before OpenCode takes over the screen.

## Development

There is no build step: the extension is plain JavaScript.

```bash
git clone https://github.com/gabrieldulolmarques/opencode-sidebar.git
cd opencode-sidebar
npm install # xterm.js with its addons, plus the headless copy and serializer
npm run package # writes opencode-sidebar.vsix
code --install-extension opencode-sidebar.vsix --force
```

Then reload the VS Code window. To debug, open the folder in VS Code and press <kbd>F5</kbd> to start an Extension Development Host.

| File | Role |
|---|---|
| `extension.js` | Extension host: the webview provider, the node-pty process, the headless screen copy, commands and terminal profile |
| `media/view.js` | Webview: xterm.js and its renderer, theme colors, fitting, centering and pixel snapping, margin color, links, clipboard |
| `media/view.css` | Webview layout |
| `media/opencode*.svg` | Sidebar and terminal tab icons |

## Credits

- [OpenCode](https://github.com/anomalyco/opencode) (MIT). The icons are drawn from the OpenCode mark in its official VS Code extension. OpenCode's name and mark belong to their owners.
- [xterm.js](https://github.com/xtermjs/xterm.js) and [node-pty](https://github.com/microsoft/node-pty) (MIT).

## License

[MIT](LICENSE)
