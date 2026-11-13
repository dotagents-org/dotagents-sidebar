# Troubleshooting and limits

## The accounts

- **No accounts tab.** dotagents has no profiles on this side of the window (WSL and Windows are separate): run `dotagents profile add <name>` there, then reload the window.
- **The tab says to run `dotagents update`, or to update this extension.** The two speak different versions of `dotagents start`'s API; update the side it names.
- **The tab stays on "Starting the dotagents server...".** The view couldn't start `dotagents start`: check that `dotagents` is on the `PATH` of the window's side (`dotagents --version` in a terminal there), or start it by hand and see what it prints.
- **The numbers are old.** The tab's ↻ asks Anthropic now; `dotagents usage --refresh` does the same in a terminal.

## Known limits

- **VS Code internals.** node-pty is not a public API. If a VS Code update moves it, the view shows an error listing the paths it tried.
- **Shortcuts without `when`.** The extension can't ask VS Code which command a key runs at the moment, so it leaves the `when` conditions out (but for bindings that need a focus the view never has). Your own `keybindings.json` is only read in a local window; in a remote one, add your keys with `dotagentsSidebar.keysForVsCode`.
- **Pasting images.** Ctrl+V pastes text only.
- **An update that changes the host's messages stops the agents.** Most updates reach the running host and the agents keep working; when the messages between the extension and the host change (`PROTOCOL` in `host.js`), the new version starts a new host and the sessions reopen their conversations.
