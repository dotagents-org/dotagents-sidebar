# Sessions

Each session is an agent running in its own terminal. The list on the right shows each one as the agent's mark in the session's color; a click switches to it, and the others keep running.

## Sessions and splits

- **New session:** the three buttons at the right of the title strip (the line over the panes, with the active session's title) open one with Claude Code (its mark), with Codex (its mark) or with your shell (the terminal's). Each session's mark in the list is its agent's, in the session's color.
- **New terminal:** the terminal button next to it opens a session with your shell (`$SHELL`, or PowerShell on Windows) in the workspace folder. Its title shows the folder the shell is in as a path (`~/work/app/src` from home and the whole path elsewhere, or `C:\Users\me\work` on Windows; cut on the left when long), which bash and PowerShell report at every prompt (other shells keep the starting folder). Exiting it cleanly closes the session; a shell that fails can be started again with Enter. It has no conversation to resume, and Restart starts a new shell.
- **Split:** `Split Session...` opens a session beside one you have open. It is the same from the amber button, the command palette, a pane's menu and a session's menu in the list. It asks two things in a row: which side (Right, Left, Down or Up; the side you used last comes first), then what opens there (Claude Code, Codex or Terminal; the kind of the session you split comes first). So Enter, Enter repeats your last split, and Escape at either step changes nothing. Splits nest: a pane split down can be split again to the right, as in herdr or the editor. A pane can be split while it sits under at most 16 splits, counted from the outermost; past that, the view says so. A pane under 64 px wide or tall is too small to show a terminal: its agent keeps its last size (a new one starts at 80x24) until the pane grows. Drag the line between two panes to resize them (each half keeps at least a tenth); the layout and its sizes are saved with the sessions. Closing a pane gives its space to the pane beside it. The pane you are typing in has a line around it in its session's color, and the sessions of a split are joined in the list by a line with a corner at each end, as the terminal panel's tabs are, in the order of the panes (left to right, top to bottom). A session that joins a split by dragging goes to the right of the one it was dropped on.
- **Reorder:** drag a session in the list, as the terminal panel's tabs work. It takes its whole split with it next to the split of the row you drop it on (after it when dragging down, before it when dragging up); dropped on a row of its own split it is only reordered inside it; dropped below the last row it goes to the end. A line shows where, the sessions that move are dimmed, and the session you moved becomes the active one. Hold **Shift** to change its split instead: dropped on a row it joins that row's split (a box shows which), and dropped below the last row it leaves its split, alone at the end of the list. **Escape** gives the drag up. The order is saved, and the accounts tab stays first.
- **Close, split, restart:** the round buttons at the left of the title strip act on the active session, red closing it, amber opening `Split Session...` and green restarting it; each shows its sign under the pointer. **Close** stops the agent and closes the session; when it was the active one inside a split, the focus stays in that split. **Restart** starts a new process in the same conversation.

- **Right click on a pane:** as `dotagentsSidebar.rightClickBehavior` says. By default it does what the integrated terminal does: on Windows it copies the selection, or pastes when there is none. Set it to `menu` to open the pane's menu instead: `Split Session...`, Copy, Paste, and the session's Rename, Color, Restart and Close. **Shift + right click** opens that menu whatever the setting.

## Back to the conversation

Each session remembers its agent's conversation. When its agent starts again (after a crash, a restart, the next day), it opens that conversation: `claude --resume`, or `codex resume`.

Codex picks its own conversation id, so the view finds it: the first rollout (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, `~/.codex` by default) created in the session's folder after the session started (`codex-sessions.js`). Codex may write it only when the first prompt is sent, so the view looks every few seconds until it finds one. A Codex session with no conversation found yet starts a new one when it restarts. A Codex session uses the account in the Codex slot of dotagents.

## The title

The view is named after the active tab, using the session's agent or *Accounts*. The title strip shows the agent's mark, the workspace and the conversation's name when the agent reports one. Claude Code reports the name set with `/rename` or the topic it picks. A name given in the list wins. The strip above the accounts panel keeps the buttons for new sessions.

## Keys

While a session has focus, the keys VS Code would keep in its integrated terminal go to VS Code: the keybindings of the commands in `terminal.integrated.commandsToSkipShell` and the first key of chords. Copy, paste and keys without Ctrl, Alt or Meta always go to the agent. Shift+Enter inserts a newline in Claude Code and in Codex. The keys in use are listed in the **dotagents-sidebar** output; `dotagentsSidebar.keysForVsCode` adds or takes back keys.

## Copy and paste

As in the integrated terminal: Ctrl+C copies when there is a selection (otherwise it goes to the agent), Ctrl+Shift+C always copies, Ctrl+V and Ctrl+Shift+V paste. A right click on a pane follows `dotagentsSidebar.rightClickBehavior` (see Sessions and splits): by default what `terminal.integrated.rightClickBehavior` says, so `copyPaste` (Windows' default) copies the selection or, with none, pastes, `paste` always pastes, and its other values open the pane's menu, which has Copy and Paste too. Shift + right click always opens the menu.

## File links

File paths an agent prints are links, underlined under the mouse: a click opens the file in the editor, at the line and column when the path says them (`src/a.ts:41`, `src/a.ts:41:7`, `src/a.ts (41,7)`, `"a.py", line 12`), and a folder in the Explorer. A path is a link only when it exists: as it is when absolute (`~` is home, `file://` too), else from the folder the sessions run in and from each workspace folder. A path with spaces is found only in double quotes. Links an agent marks itself (OSC 8) work too: web pages open in the browser, `file://` in the editor. Every link opens on a click, unlike the integrated terminal's Ctrl+click; dragging from a link still selects. A web page goes through VS Code's trusted domains, which ask before opening a site you haven't trusted; a file opens without asking.

## The terminal's look

The view uses `terminal.integrated.fontFamily`, `fontSize`, `lineHeight`, `letterSpacing`, `fontWeight`, `fontWeightBold`, `minimumContrastRatio` and `scrollback`, and the theme's terminal colors. Changes apply without restarting the agents.

## Colors and names

Right-click a session for *Rename*, *Change Color* (the terminal panel's eight colors, or none), *Restart* and *Close*.

## Terminal profiles

*Claude Code* and *Codex* entries in the terminal panel's `⌄` menu open them in a regular terminal, with the same command and environment as the view.

## Commands

| Command | Where | What it does |
|---|---|---|
| `dotagents-sidebar: New Claude Code Session` | title strip, Claude Code's mark | A Claude Code session |
| `dotagents-sidebar: New Codex Session` | title strip, Codex's mark | A Codex session |
| `dotagents-sidebar: New Terminal` | title strip | A session with your shell |
| `dotagents-sidebar: Split Session...` | title strip's amber button, pane and session menus | Asks the side, then Claude Code, Codex or Terminal, and opens it beside the session |
| `dotagents-sidebar: Restart Session` | title strip's green button, pane and session menus | A new process in the same conversation |
| `dotagents-sidebar: Close Session` | title strip's red button, pane and session menus | Stops the agent and closes the session |
| `dotagents-sidebar: Rename Session...` | pane and session menus | Names the session; the title shows it |
| `dotagents-sidebar: Change Session Color...` | pane and session menus | One of the terminal panel's colors, or none |
| Copy, Paste | pane menu | Copies the pane's selection, or pastes into it |
| `dotagents-sidebar: Switch Account` | status bar | Lists the accounts and switches, on both sides ([Accounts](accounts.md)) |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `dotagentsSidebar.renderer` | `webgl` | `webgl` or `dom`: how the view draws the terminal. WebGL draws block characters without hairlines between rows |
| `dotagentsSidebar.rightClickBehavior` | `terminal` | What a right click on a pane does: `terminal` (as `terminal.integrated.rightClickBehavior`), `copyPaste`, `paste` or `menu`. Shift + right click always opens the menu |
| `dotagentsSidebar.keysForVsCode` | `[]` | Keys that go to VS Code on top of the worked-out ones (`"ctrl+e"`), or back to the agent (`"-ctrl+p"`) |
