# Getting started

## Requirements

- VS Code **1.106** or newer: the first version with the secondary sidebar's view containers.
- Install the agents you want to run where the workspace runs. The view looks for Claude Code (`claude`) and Codex (`codex`) on the `PATH` set by interactive Bash, or by PowerShell on Windows.
- For the accounts tab, install [dotagents-core](https://github.com/dotagents-org/dotagents-core) with API 2 support and set up profiles on the same side as the window. Agent sessions work independently. See [Accounts](accounts.md).

## Install

The extension is not on the Marketplace and has no release yet, so build the `.vsix` from the repository:

1. In a clone of this repository: `npm install`, then `npm run package`, which writes `dotagents-sidebar.vsix`.
2. In VS Code, run **Extensions: Install from VSIX...** and pick the file, or run `code --install-extension dotagents-sidebar.vsix`.
3. Run **Developer: Reload Window**.

In a remote window (WSL, SSH, dev containers), install it while connected, so it lands on the remote side, where the agents and dotagents run.

## The first session

Open the secondary sidebar (**View: Toggle Secondary Side Bar Visibility**) and pick the **dotagents: Sidebar** view. The title strip has buttons for Claude Code, Codex and your shell. New sessions start in the first workspace folder, or your home folder when no folder is open. The view opens a Claude Code session when there are no saved sessions. With dotagents set up, **Accounts** is the first tab in the list.

## Updates

VS Code can't update an extension installed from a `.vsix`. To update, pull the repository, build the `.vsix` again and install it the same way. The running agents survive the update when the host's messages didn't change ([Architecture](architecture.md#the-host)).
