# Sessions

Each session is an agent running in its own terminal. The list on the right shows each one as the agent's mark in the session's color; a click switches to it, and the others keep running.

## Sessions and splits

- **New session:** `+` opens one with the agent used last; the `⌄` next to it picks the agent, or splits with it.
- **Split:** opens a session next to the active one. A split shows side by side in a wide view and stacked in a tall one.
- **Close:** stops the agent and closes the session. **Restart** starts a new process in the same conversation.

## Back to the conversation

Each session remembers its agent's conversation. When its agent starts again (after a crash, a restart, the next day), it opens that conversation: `--resume` for Claude Code (`--session` for OpenCode, `resume` for Codex, when they are on).

## The title

The view is named after the active tab: the session's agent, or *Accounts* on the accounts tab. The strip on top shows the agent's mark, the workspace and the conversation's name, which Claude Code reports by itself (`/rename`, or the topic it picks). A name given in the list wins. The accounts tab has no strip: the panel starts with its own seal.

## Keys

While a session has focus, the keys VS Code would keep in its integrated terminal go to VS Code: the keybindings of the commands in `terminal.integrated.commandsToSkipShell` and the first key of chords. Copy, paste and keys without Ctrl, Alt or Meta always go to the agent. Shift+Enter inserts a newline in Claude Code. The keys in use are listed in the **dotagents-sidebar** output; `dotagentsSidebar.keysForVsCode` adds or takes back keys.

## Copy and paste

As in the integrated terminal: Ctrl+C copies when there is a selection (otherwise it goes to the agent), Ctrl+Shift+C always copies, Ctrl+V and Ctrl+Shift+V paste. A right click follows `terminal.integrated.rightClickBehavior`: `copyPaste` (Windows' default) copies the selection or, with none, pastes; `paste` always pastes; any other value leaves the click alone.

## File links

As in the integrated terminal, file paths an agent prints are links: Ctrl+click (Cmd+click on a Mac) opens the file in the editor, at the line and column when the path says them (`src/a.ts:41`, `src/a.ts:41:7`, `src/a.ts (41,7)`, `"a.py", line 12`), and a folder in the Explorer. A path is a link only when it exists: as it is when absolute (`~` is home, `file://` too), else from the folder the sessions run in and from each workspace folder. A path with spaces is found only in double quotes. Links an agent marks itself (OSC 8) work too: web pages open in the browser, `file://` in the editor.

## The terminal's look

The view uses `terminal.integrated.fontFamily`, `fontSize`, `lineHeight`, `letterSpacing`, `fontWeight`, `fontWeightBold`, `minimumContrastRatio` and `scrollback`, and the theme's terminal colors. Changes apply without restarting the agents.

## Colors and names

Right-click a session for *Rename*, *Change Color* (the terminal panel's eight colors, or none), *Restart* and *Close*.

## Terminal profiles

A *Claude Code* entry in the terminal panel's `⌄` menu opens it in a regular terminal, with the same command and environment as the view.

## Commands

| Command | Where | What it does |
|---|---|---|
| `dotagents-sidebar: New Session` | `+` | A session with the agent used last |
| `dotagents-sidebar: New Session With...` | `⌄` | A session with the agent you pick, or a split with it |
| `dotagents-sidebar: Split Session` | title bar | A session next to the active one |
| `dotagents-sidebar: Restart Session` | title bar, session menu | A new process in the same conversation |
| `dotagents-sidebar: Close Session` | title bar, session menu | Stops the agent and closes the session |
| `dotagents-sidebar: Rename Session...` | session menu | Names the session; the title shows it |
| `dotagents-sidebar: Change Session Color...` | session menu | One of the terminal panel's colors, or none |
| `dotagents-sidebar: Switch Claude Account` | status bar | Lists the accounts and switches, on both sides ([Accounts](accounts.md)) |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `dotagentsSidebar.renderer` | `webgl` | `webgl` or `dom`: how the view draws the terminal. WebGL draws block characters without hairlines between rows |
| `dotagentsSidebar.keysForVsCode` | `[]` | Keys that go to VS Code on top of the worked-out ones (`"ctrl+e"`), or back to the agent (`"-ctrl+p"`) |
