# Changelog

What changed in each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Changes land in **Unreleased** as they are made; a release turns that section into its version and its notes.

## Unreleased

### Added

- **Terminal.** A terminal button next to the new-session one opens a session with your shell in the workspace folder, with its own icon in the list.
- **Terminal title.** A terminal session's title shows the folder its shell is in, as a path from the workspace (`work/app/src`), from `~` when it is in the home folder, or whole when it is elsewhere; the folder you are in is highlighted, a long path is cut on the left, and the tooltip has the full path. Bash (through `shell/bash-cwd.sh`, which loads `~/.bashrc` first) and PowerShell report it at every prompt; other shells keep the folder the session started in.
- **Own icons.** Every button on the title bar and every dotagents mark share one geometry (the face's square, a 1.9 line, the whole box used): a prompt (`>_`) in place of the eyes for the terminal, the face with a `+` cut in its corner for a new session, a line down the middle for split, a green circular arrow for restart and a red cross for close, instead of the `+` that now read as "new anything".
- **File links.** File paths in a session are links, underlined under the mouse: a click opens the file at its line and column (`src/a.ts:41:7`, `(41,7)`, `", line 12"`), or a folder in the Explorer. Only paths that exist are links, tried from the sessions' folder and each workspace folder; a path with spaces needs double quotes. Links an agent marks itself (OSC 8) open too: web pages in the browser, `file://` in the editor.
- **Sessions:** several Claude Code sessions side by side, with splits like the terminal panel, a session list, and agents that keep running across window reloads (a detached host process).
- **Your Claude accounts, with [dotagents](https://github.com/dotagents-org/dotagents-core):** on a machine where dotagents has profiles, the list starts with a fixed *Accounts* tab: every account's usage, its state as an avatar, and a switch that puts it on both sides of the machine. The status bar shows the current account and its usage as in the statusLine; a click switches. The data comes from `dotagents start` (dotagents-core 0.1.0 or later), which the view starts in the background when none answers.
- **Claude Code only, for now:** OpenCode and Codex are switched off; their support stays in the code.

### Changed

- **Same size everywhere.** The session list and the title strip draw the marks at 16 px, the size VS Code gives its own title bar buttons and the view's icon at the top, and every mark uses the whole square, so they look the same size. The list's rows are taller (28 px, were 22) to keep them easy to click.
- **Session colors.** A new session takes a color no open session has, or the least used one, instead of the next in a fixed rotation that could repeat an open session's color after others closed.

### Fixed

- **Paste on Windows.** Ctrl+V sent a ^V before the text, which Claude Code on Windows reads as pasting an image, so the text never came. Now only the paste itself reaches the agent, as in the integrated terminal.
- **Copy and paste like the integrated terminal.** Ctrl+Shift+C copies and Ctrl+Shift+V pastes; a right click copies the selection or pastes, as `terminal.integrated.rightClickBehavior` says (`copyPaste` by default on Windows).
- **On Windows, `dotagents start` runs on its own.** The view used to start it tied to a console window, so closing that window, or VS Code, stopped the server and the accounts tab went back to *Starting*. It now starts it through a hidden `Start-Process`.

### Removed

- **OpenCode and Codex.** Their support, switched off since 0.1.0, is gone from the code: the sidebar runs Claude Code only. With one agent, the `⌄` menu next to `+` (New Session With..., Split Session With) is gone too: `+` and the split button open Claude Code.
