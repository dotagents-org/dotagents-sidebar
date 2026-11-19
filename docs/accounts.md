# Accounts

With [dotagents](https://github.com/dotagents-org/dotagents-core), one person holds several Claude accounts (and, with the Codex support, ChatGPT accounts for Codex) on one machine: `dotagents switch` puts an account's login in `~/.claude` or `~/.codex`, and `dotagents usage` says how much of each plan is used. The view shows the same, live, and switches.

## When it shows

The accounts tab and the status bar appear when dotagents has profiles on the side of the window: a `profiles.json` in dotagents' state folder (`$DOTAGENTS_STATE_DIR`, or `$XDG_CONFIG_HOME/dotagents`, or `~/.config/dotagents`). Without it, the view has the sessions only.

## The accounts tab

The first tab in the list, marked with the accounts' dot. It never closes or splits. It shows:

- the accounts grouped by provider, Claude first, when there are two: a header with the provider's mark (Claude, OpenAI), its name and its plan, by the product's name, with the seats (*Team  2 seats* for Claude, *Business  2 seats* for ChatGPT, whose API still says `team`) when every account of the group has the same known plan, else the count; with one provider there is no header;
- every account in a card with its avatar and name in its color. Click its mark to open Claude Desktop or the ChatGPT app on Windows, including from WSL when the Windows launcher is set up. Claude cards also show what their sessions are doing (*1 working*, *1 waiting on you*);
- each usage window as a bar in text, with its percentage (green below 70%, amber from 70%, red from 90%), reset time and projection (*at this pace, runs out 16:40*). Both providers show the 5-hour and weekly windows. Claude also shows per-model windows when available;
- where the account is (*on WSL*, *on Windows and WSL*) and a `[ switch ]` that puts it on both sides of the machine; one side only is `dotagents switch <profile> --here`, in a terminal. After a switch, the panel and the notification say what to do next, in the words `dotagents switch` ends with: Claude's open conversations go on in the new account once you type `continue`, and Codex sessions already open keep the old account until you restart them;
- above the cards, how old the snapshot is and a ↻ button to run a refresh for both providers, subject to each profile's polling interval and retry delay. When the other side is offline, the same line shows its name and *off*.

## The avatars

Each account has an avatar in its color and shape. Turing is a rounded square, Lovelace a circle, Hopper a hexagon and Dijkstra an arch. Other names get a shape from a hash of the name. dotagents' own is the `..` face. The eyes and the dot show the most urgent state: `error` (sign in again), `limit` (a window at 100%), `waiting` (a Claude Code session waits on you), `warn` (70% or more, or the pace runs out before the reset), `ok`, `asleep` (no fresh data). A Claude Code session at work makes its account's avatar hop. ChatGPT avatars show usage and login states. The avatars only move while the tab shows.

## The status bar

One group per provider, side by side: Claude's, and ChatGPT's only when there is a ChatGPT account. Each group shows the current account of its provider (the one in the slot, the worse of the two sides) as the statusLine shows it: the provider's mark (Claude's, or OpenAI's on a ChatGPT account) and the name in its color, the state as the avatars' dot, and each window's bar and percentage, with ↻ and the time to the reset from 70% on (`personal ● 5h ━━━━━━── 79% ↻ 3h17m  7d ━━━───── 38%`). The tooltip lists its provider's accounts. Click the account name to pick from both providers and switch the chosen account on every side, even if it is already current on one side. All the items share one priority, so no other extension's item lands between them.

The marks are glyphs of `media/icons.woff`, which `scripts/vscode-icon.py` writes (the status bar takes icons only from fonts).

## Where the data comes from

From `dotagents start`, on the side of the window: a local API on 127.0.0.1 that answers only with the token it leaves in `start.json`, in the same state folder. The view asks it every 10 seconds. When none answers, the view starts one in the background (at most once a minute), on its own: on Windows through a hidden `Start-Process`, so no console window holds it and closing VS Code doesn't stop it; a `start.json` left behind by a server that stopped, after a WSL shutdown for example, doesn't count. One server serves every window on that side.

Every answer carries `apiVersion`. The view knows version 3; with another, it says which side to update: `dotagents update` when dotagents is older, this extension when dotagents is newer. The API is described in dotagents' [commands](https://github.com/dotagents-org/dotagents-core/blob/main/docs/commands.md#dotagents-start).

## Without the tab

`dotagents usage` shows the same numbers in a terminal, and `dotagents usage --short` fits a status line.
