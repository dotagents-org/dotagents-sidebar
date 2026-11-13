# Changelog

What changed in each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Changes land in **Unreleased** as they are made; a release turns that section into its version and its notes.

## Unreleased

## 0.1.2 - 2026-11-13

### Fixed

- **Paste on Windows.** Ctrl+V sent a ^V before the text, which Claude Code on Windows reads as pasting an image, so the text never came. Now only the paste itself reaches the agent, as in the integrated terminal.
- **Copy and paste like the integrated terminal.** Ctrl+Shift+C copies and Ctrl+Shift+V pastes; a right click copies the selection or pastes, as `terminal.integrated.rightClickBehavior` says (`copyPaste` by default on Windows).

## 0.1.1 - 2026-11-13

### Fixed

- **On Windows, `dotagents start` runs on its own.** The view used to start it tied to a console window, so closing that window, or VS Code, stopped the server and the accounts tab went back to *Starting*. It now starts it through a hidden `Start-Process`.

## 0.1.0 - 2026-11-13

The first release of dotagents-sidebar: Claude Code and your Claude accounts in VS Code's secondary sidebar.

### Added

- **Sessions:** several Claude Code sessions side by side, with splits like the terminal panel, a session list, and agents that keep running across window reloads (a detached host process).
- **Your Claude accounts, with [dotagents](https://github.com/dotagents-org/dotagents-core):** on a machine where dotagents has profiles, the list starts with a fixed *Accounts* tab: every account's usage, its state as an avatar, and a switch that puts it on both sides of the machine. The status bar shows the current account and its usage as in the statusLine; a click switches. The data comes from `dotagents start` (dotagents-core 0.1.0 or later), which the view starts in the background when none answers.
- **Claude Code only, for now:** OpenCode and Codex are switched off; their support stays in the code.
