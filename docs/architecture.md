# Architecture and development

## The webview

VS Code's API only lets extensions put terminals in the terminal panel or the editor, not in a sidebar, so the view is a webview that draws its own terminals with [xterm.js](https://xtermjs.org), the library the integrated terminal uses. The accounts tab is part of the same page: its scripts load the first time the tab opens, so nothing of it runs while only the sessions are in use, and its styles stay inside its `.panel`.

## The host

The agents don't run in the extension. On first use, the extension starts `host.js` as a detached process, one per workspace, and talks to it over a socket in a folder only you can open (0700). The host runs each agent through **node-pty** (the copy that ships inside VS Code, loaded from `vscode.env.appRoot`) and keeps a headless copy of each screen ([`@xterm/headless`](https://www.npmjs.com/package/@xterm/headless)). After a reload, the extension connects again and the view redraws every screen from those copies. With no extension connected for a minute, the host stops the agents and exits. Agents run with VS Code's own `ELECTRON_*` and `VSCODE_*` variables removed from their environment, as in the integrated terminal.

The host is named by workspace and protocol (`PROTOCOL` in `host.js`), not by the extension's version, so an update reaches the host the old version started and the agents keep running. A change to the messages between the two raises the protocol and starts a new host.

## The accounts

`accounts.js` talks to `dotagents start` (the address and token in `start.json`), shows the status bar and the switch, and gives the view what the accounts tab needs: the panel's folder, what the panel is told and when it changes, and its actions. The rules (the states, the projections, the switch itself) live in dotagents; the extension only shows them ([Accounts](accounts.md)).

## Files

| File | Role |
|---|---|
| `extension.js` | The view provider, the sessions, the commands, the connection to the host, the updates |
| `host.js` | The detached process that owns the agents and their screen copies |
| `providers.js` | The agents: command, environment, conversation flags, newline key, which are on |
| `sessions.js` | The session list: add, split, close, rename, colors, restore |
| `accounts.js` | The Claude accounts: the server of `dotagents start`, the status bar, the switch, what the accounts tab is told |
| `media/view.js`, `media/view.css` | The webview: a terminal per session, the list, the title strip |
| `media/keys.js` | Which keys go to VS Code, worked out from the keybindings |
| `media/accounts/` | The accounts tab: the panel (`panel.js`, `panel.css`) and the avatars, drawn live (`avatar.js`) |
| `skip-shell.json` | VS Code's default commands that skip the shell, copied from its source |
| `scripts/avatars/generate.mjs` | The avatars as still pictures and strips, for documents (`assets/avatars/`); the same rules as `avatar.js` |
| `scripts/readme/generate.mjs` | The README's pictures of the avatars (`assets/readme/`) |
| `scripts/vscode-icon.py` | The status bar's mark, a glyph of `media/icons.woff` |
| `scripts/lockup.py` | The README lockup (SVG, then the PNGs the README shows) from the mark and Geist Mono |

## Development

There is no build step: the extension is plain JavaScript.

```bash
git clone https://github.com/dotagents-org/dotagents-sidebar.git
cd dotagents-sidebar
npm install
npm test # node:test, test/*.test.mjs
npm run package # writes dotagents-sidebar.vsix
```

To debug, open the folder in VS Code and press <kbd>F5</kbd> to start an Extension Development Host. The tests cover what the extension decides without VS Code (sessions, providers, keys, the accounts' status bar and the switch list, the manifest against the code); the rest is checked by hand in VS Code. CI runs the tests and packages the `.vsix` on every push.

## Releases

A release is a signed tag `vX.Y.Z` with the version in `package.json`, and a GitHub release with the `.vsix` attached, which the extension's update check finds. The README shows PNG pictures: the packager refuses SVGs in a README.
