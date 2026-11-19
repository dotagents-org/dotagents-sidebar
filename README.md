<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/dotagents-sidebar-lockup-dark.png">
    <img alt="dotagents-sidebar" src="assets/dotagents-sidebar-lockup-light.png" width="420">
  </picture>
</p>

<p align="center"><b>Claude Code and Codex in VS Code's secondary sidebar.<br>Your Claude and ChatGPT accounts beside it, live, a click away from switching.</b></p>

<p align="center">
  <a href="#features">Features</a>&nbsp;&nbsp;&nbsp;
  <a href="#how-it-works">How it works</a>&nbsp;&nbsp;&nbsp;
  <a href="#quick-start">Quick start</a>&nbsp;&nbsp;&nbsp;
  <a href="docs/README.md">Documentation</a>&nbsp;&nbsp;&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img alt="VS Code 1.106 or later" src="https://img.shields.io/badge/vscode-%E2%89%A5%201.106-171717">
  <img alt="Local, WSL, SSH, containers" src="https://img.shields.io/badge/runs-local%2C%20WSL%2C%20SSH%2C%20containers-171717">
  <img alt="Claude Code" src="https://img.shields.io/badge/agent-Claude%20Code-171717">
  <img alt="Codex" src="https://img.shields.io/badge/agent-Codex-171717">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-171717">
</p>

> [!NOTE]
> **An unofficial community project**, not affiliated with or endorsed by Anthropic or OpenAI. It runs Claude Code and Codex.

The official extensions of Claude Code and Codex put them in a chat panel or a terminal tab. This one gives them a view of their own in the secondary sidebar, laid out like VS Code's terminal panel: the agent's terminal UI on the left, the list of sessions on the right, and the agents keep working while the window reloads.

With [dotagents](https://github.com/dotagents-org/dotagents-core), it is also where your Claude and ChatGPT accounts live in VS Code: the first tab shows every account's usage, its state as an avatar, and the switch; the status bar shows the current one. It works without dotagents, with the sessions only.

## Features

**Sessions**

- **Sessions like terminals.** Each session is an agent in its own terminal; the Claude Code or Codex button opens one, and the list switches between them while the others keep running.
- **Splits.** Right, left, down or up, nested, with the line between panes to drag, and Claude Code, Codex or a terminal on the new side; joined in the list as the terminal panel's tabs are. Drag a session to reorder it (its split goes with it); with Shift, drop it on another to join that split on the side you pick, or below the last one to leave its split.
- **Agents survive a reload.** They run in a small host process of their own, so **Developer: Reload Window** brings the view back with every screen as it was.
- **Claude Code and Codex.** The title strip has one button per agent, Claude Code and Codex, each with its mark, and one for a terminal; each session shows its agent's mark.
- **Back to the right conversation.** A session that starts again (a crash, a restart, the next day) opens its conversation with `--resume` (`codex resume` for Codex). The agent itself tells which one it is in, through a `SessionStart` hook given on its command line only, so a `/clear` or `/resume` inside it, or two Codex sessions started together in one folder, send a restart to the conversation it is in. Codex tells a new one at its first message, so a restart right after its `/resume`, before you send anything, opens the one before.
- **Like the integrated terminal.** Your terminal font and colors, VS Code's shortcuts while a session has focus, copy and paste, a click on a file path to open it, Shift+Enter for a newline, names and colors per session.

**Your Claude and ChatGPT accounts, with dotagents**

- **The accounts tab.** Every account with its plan, its 5-hour, weekly and model windows, the projection to the reset, and a switch that puts it on both sides of the machine, then says what to do with the sessions already open.
- **Avatars that say how it is.** Each account in its color and shape; the eyes and the dot in the corner give its state, and a session at work makes it hop.
- **The status bar.** A group for each provider, showing its current account and usage as in the statusLine; a click switches.

**Everywhere**

- **Remote ready.** It runs where the workspace runs: locally, in WSL, over SSH and in dev containers.

## How it works

The view is a webview with its own terminals ([xterm.js](https://xtermjs.org)), since VS Code doesn't let an extension put terminals in a sidebar. The agents run in a detached host process, one per workspace, that keeps each screen, so a reload or an update only reconnects to it. The accounts come from `dotagents start`, dotagents' local API on 127.0.0.1, which the view starts when none answers. More in [Architecture](docs/architecture.md).

### The accounts

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/avatars-dark.png">
    <img alt="The avatars at work: dotagents, turing and lovelace" src="assets/readme/avatars-light.png" width="400">
  </picture>
</p>

The eyes and the dot in the corner say how each account is:

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/states-dark.png">
    <img alt="The avatars' states: ok, working, waiting on you, warn, at the limit, sign in again, asleep" src="assets/readme/states-light.png" width="760">
  </picture>
</p>

## Quick start

You need VS Code 1.106+ and [Claude Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex/cli) on the `PATH` where the workspace runs.

1. In a clone of this repository: `npm install`, then `npm run package`, which writes `dotagents-sidebar.vsix`.
2. Run **Extensions: Install from VSIX...** (in a remote window, while connected), then **Developer: Reload Window**.
3. Open the secondary sidebar and pick **dotagents: Sidebar**; the Claude Code or Codex button starts a session.

For the accounts, set up [dotagents](https://github.com/dotagents-org/dotagents-core#quick-start) on the same side and add your profiles; the tab appears on the next reload. More in [Getting started](docs/getting-started.md).

## Documentation

- [Getting started](docs/getting-started.md): requirements, installing, the first session, updates.
- [Sessions](docs/sessions.md): sessions and splits, the conversation, keys, commands and settings.
- [Accounts](docs/accounts.md): the accounts tab, the avatars, the status bar, and how the view finds dotagents.
- [Architecture and development](docs/architecture.md): the webview and the host, the files, tests, releases.
- [Troubleshooting and limits](docs/troubleshooting.md).

## Contributing

Issues and pull requests are welcome. There is no build step: `npm install`, `npm test` (`node:test`) before a pull request, `npm run package` for the `.vsix`; details in [Architecture and development](docs/architecture.md#development). Commits are one line in English, gitmoji plus [Conventional Commits](https://www.conventionalcommits.org/) (`✨ feat: …`).

## The family

- **[dotagents-core](https://github.com/dotagents-org/dotagents-core)**: the `dotagents` command, the workspace standards, and the logic of the Claude and ChatGPT accounts, with the local API (`dotagents start`).
- **dotagents-config**: your configuration, a repository of your own next to dotagents-core.
- **dotagents-sidebar**, this repository: Claude Code, Codex and your Claude and ChatGPT accounts in VS Code's secondary sidebar.

## Credits

- [xterm.js](https://github.com/xtermjs/xterm.js) and [node-pty](https://github.com/microsoft/node-pty) (MIT).
- The Claude Code mark in the session list is Anthropic's, and the Codex mark OpenAI's; each belongs to its owner.
- The shortcut rules follow VS Code's integrated terminal ([MIT](https://github.com/microsoft/vscode/blob/main/LICENSE.txt)).
- The type is [Geist Mono](https://vercel.com/font) (OFL), as in dotagents.

## License

[MIT](LICENSE)
