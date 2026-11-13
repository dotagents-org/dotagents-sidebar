# Getting started

## Requirements

- VS Code **1.106** or newer: the first version with the secondary sidebar's view containers.
- [Claude Code](https://claude.com/claude-code) (`claude`) installed where the workspace runs, on the `PATH` that `~/.bashrc` sets up: the view starts it with `bash -ic claude` (on Windows, `powershell.exe -NoLogo -Command claude`).
- For the accounts tab: [dotagents](https://github.com/dotagents-org/dotagents-core) 0.1.0 or later, with its profiles, on the same side as the window ([Accounts](accounts.md)). Without it, the view has the sessions only.

OpenCode and Codex are switched off for now; their support stays in the code (`off: true` in `providers.js`).

## Install

The extension is not on the Marketplace. Install the `.vsix` from a release:

1. Download `dotagents-sidebar.vsix` from the [latest release](https://github.com/dotagents-org/dotagents-sidebar/releases/latest).
2. In VS Code, run **Extensions: Install from VSIX...** and pick the file, or run `code --install-extension dotagents-sidebar.vsix`.
3. Run **Developer: Reload Window**.

In a remote window (WSL, SSH, dev containers), install it while connected, so it lands on the remote side, where the agents and dotagents run.

## The first session

Open the secondary sidebar (**View: Toggle Secondary Side Bar Visibility**) and pick the **dotagents: Sidebar** view. `+` starts a Claude Code session in the first workspace folder, or in your home folder when no folder is open. With dotagents set up, the list starts with the accounts tab, and the view opens on it while there is no session yet.

## Updates

VS Code can't update an extension installed from a `.vsix`, so once a day the extension looks for a newer GitHub release and offers to install it, show its notes or skip that version. The running agents survive the update when the host's messages didn't change ([Architecture](architecture.md#the-host)).
