# Accounts

With [dotagents](https://github.com/dotagents-org/dotagents-core), one person holds several Claude accounts on one machine: `dotagents switch` puts an account's login in `~/.claude`, and `dotagents usage` says how much of each plan is used. The view shows the same, live, and switches.

## When it shows

The accounts tab and the status bar appear when dotagents has profiles on the side of the window: a `profiles.json` in dotagents' state folder (`$DOTAGENTS_STATE_DIR`, or `$XDG_CONFIG_HOME/dotagents`, or `~/.config/dotagents`). Without it, the view has the sessions only.

## The accounts tab

The first tab in the list, marked with the accounts' dot. It never closes or splits. It shows:

- every account in a card: its avatar, its name in its color, a button that opens its Claude Desktop app (Windows), and what its sessions are doing (*1 working*, *1 waiting on you*);
- each window (5 hours, the week, the model's week) as a bar in text, its percentage in the level's color (green below 70%, amber from 70%, red from 90%), when it resets, and the projection to the reset (*at this pace, runs out 16:40*);
- where the account is (*on WSL*, *on Windows and WSL*) and a `[ switch ]` that puts it on both sides of the machine; one side only is `dotagents switch <profile> --here`, in a terminal;
- at the bottom, the sides and how old the numbers are, with ↻ to ask Anthropic now.

## The avatars

Each account has an avatar, in its color and shape; dotagents' own is the `..` face. The eyes give the state's shape and the dot in the corner its color, one state at a time, the most urgent first: `error` (sign in again), `limit` (a window at 100%), `waiting` (a session waits on you), `warn` (70% or more, or the pace runs out before the reset), `ok`, `asleep` (no fresh data). A session at work makes it hop. The avatars only move while the tab shows.

## The status bar

The current account (the one in the slot, the worse of the two sides) as the statusLine shows it: the accounts' mark and the name in its color, the state as the avatars' dot, and each window's bar and percentage, with ↻ and the time to the reset from 70% on (`personal ● 5h ━━━━━━── 79% ↻ 3h17m  7d ━━━───── 38%`). The tooltip lists every account; a click lists them to switch, on both sides.

## Where the data comes from

From `dotagents start`, on the side of the window: a local API on 127.0.0.1 that answers only with the token it leaves in `start.json`, in the same state folder. The view asks it every 10 seconds. When none answers, the view starts one in the background (at most once a minute), on its own: on Windows through a hidden `Start-Process`, so no console window holds it and closing VS Code doesn't stop it; a `start.json` left behind by a server that stopped, after a WSL shutdown for example, doesn't count. One server serves every window on that side.

Every answer carries `apiVersion`. The view knows version 1; with another, it says which side to update: `dotagents update` when dotagents is older, this extension when dotagents is newer. The API is described in dotagents' [commands](https://github.com/dotagents-org/dotagents-core/blob/main/docs/commands.md#dotagents-start).

## Without the tab

`dotagents usage` shows the same numbers in a terminal, and `dotagents usage --short` fits a status line.
