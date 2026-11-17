// The accounts tab's panel: draws the usage JSON of `dotagents start` (every profile, the account
// in each side's slot), which the extension (accounts.js) posts, and asks it for the actions.
"use strict";

(() => {
  // Styles go through the CSSOM: the page's security policy refuses style="..." attributes.
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") Object.assign(node.style, v);
      else if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }

  // A bar in text, as in `dotagents usage`: the used part in ━, a space, the rest in ─, always as
  // wide (core/usage.ts bar()).
  const BAR = 16;
  function bar(pct, tone) {
    const p = Math.max(0, Math.min(100, pct));
    const used = p >= 100 ? BAR : p <= 0 ? 0 : Math.max(1, Math.min(Math.round((p / 100) * BAR), BAR - 2));
    const rest = p >= 100 ? 0 : p <= 0 ? BAR : BAR - used - 1;
    return el("span", { class: "bar" }, used ? el("span", { class: tone }, "━".repeat(used)) : null, used && rest ? " " : null, rest ? el("span", { class: "trk" }, "─".repeat(rest)) : null);
  }
  const level = (pct) => (pct >= 90 ? "high" : pct >= 70 ? "warn" : "ok");
  const label = (w) => (w.kind === "session" ? "5h" : w.kind === "week" ? "7d" : w.model || "model");
  const span = (ms) => {
    const m = Math.floor(ms / 60000);
    if (m < 1) return "<1m";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
  };
  const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const dayTime = (d) => `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(d)}`;

  const dark = () => document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast") || (!document.body.classList.contains("vscode-light") && matchMedia("(prefers-color-scheme: dark)").matches);
  // An account's color as text: on a dark background, a third of the way to white, or a dark one
  // (#376B80) fades into it.
  function nameColor(hex) {
    if (!dark() || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    const mix = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (255 - parseInt(hex.slice(i, i + 2), 16)) / 3).toString(16).padStart(2, "0");
    return `#${mix(1)}${mix(3)}${mix(5)}`;
  }

  // The avatar, live: avatar.js paints it on a canvas every animation frame.
  function avatar(name, color, state, working) {
    const canvas = el("canvas", { class: "av", role: "img", "aria-label": `${name}, ${state}${working ? ", working" : ""}` });
    window.dotagentsAvatar.mount(canvas, { who: name, color, state, working, size: parseFloat(getComputedStyle(root).getPropertyValue("--avatar")) || 56 });
    return canvas;
  }

  function windowRow(p, w, now) {
    const tone = level(w.pct);
    const reset = w.reset || !w.resetsAt ? (w.kind === "session" ? "no window open" : "reset") : `resets ${span(Date.parse(w.resetsAt) - now)}`;
    let projection = null;
    const pr = p.state === "ok" ? w.projection : null;
    if (pr && pr.from) projection = el("span", { class: "note" }, `projection from ${w.kind === "session" ? hhmm(new Date(pr.from)) : dayTime(new Date(pr.from))}`);
    else if (pr && pr.runsOutAt) {
      const when = new Date(pr.runsOutAt);
      projection = el("span", { class: "note warn" }, `at this pace, runs out ${w.kind === "session" ? hhmm(when) : dayTime(when)}`);
    } else if (pr) projection = el("span", { class: "note" }, `~${pr.atResetPct}% at reset`);
    return el(
      "div",
      { class: "window" },
      el("span", { class: "label" }, label(w)),
      bar(w.pct, tone),
      el("span", { class: `pct ${tone}` }, `${w.pct}%`),
      el("span", { class: `reset ${tone === "ok" ? "muted" : tone}` }, reset),
      projection
    );
  }

  // Icons, drawn in the text's color. The Claude and OpenAI marks are LobeHub's (MIT): an account
  // and its app show the company's mark; refresh is Lucide's rotate-cw (ISC).
  function icon(paths, stroke) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of paths) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      if (stroke) for (const [k, v] of Object.entries({ fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) path.setAttribute(k, v);
      else path.setAttribute("fill", "currentColor");
      svg.append(path);
    }
    return svg;
  }

  // An action under way and the last failure live here, outside the drawing, so a redraw (new
  // data comes in the middle of a switch) keeps them. No text while it runs: the button clicked
  // pulses, the result shows in the data, and only a failure is written, until the next action.
  let pending = null;
  let failure = "";
  let shown = null;

  // root: where to draw; data: the usage JSON; act(action, body): runs an action, resolves to
  // { ok, detail }.
  function render(root, data, { act, providers }) {
    shown = { root, data, act, providers };
    const redraw = () => render(shown.root, shown.data, shown);
    const now = Date.now();
    // The slots per provider (apiVersion 2): { claude: { WSL: "work" }, codex: { ... } }.
    const slotsOf = (p) => (data.slots && data.slots[p.provider || "claude"]) || {};
    const sides = data.sides || [];
    // key: which button shows the action under way; one action at a time.
    const run = (action, body, key) => async () => {
      if (pending) return;
      pending = key;
      failure = "";
      redraw();
      const res = await act(action, body).catch((err) => ({ ok: false, detail: String(err) }));
      pending = null;
      failure = res.ok ? "" : res.detail || "it failed";
      redraw();
    };
    const busy = (key) => (pending && pending === key ? " busy" : "");
    const cardOf = (p) => {
      const slots = slotsOf(p);
      const provider = providers[p.provider || "claude"];
      const here = sides.filter((s) => slots[s] === p.name);
      const doing = p.activity ? [p.activity.working && `${p.activity.working} working`, p.activity.waiting && `${p.activity.waiting} waiting on you`].filter(Boolean).join(", ") : "";
      const status = p.avatar === "error" ? p.error || `no login here, run: dotagents login ${p.name}` : doing;
      // Where the account is, and one switch that puts it on every side (the command's --here,
      // for one side only, stays in the terminal).
      const everywhere = sides.length > 0 && here.length === sides.length;
      const key = `switch ${p.name}`;
      const where = el("span", { class: "muted" }, here.length ? `on ${here.join(" and ")}` : "");
      const button = el("button", { type: "button", class: `switch${busy(key)}`, title: `Use ${p.name} on ${sides.join(" and ") || "this machine"}` }, everywhere ? "in use" : "switch");
      if (everywhere) button.disabled = true;
      else button.addEventListener("click", run("switch", { profile: p.name }, key));
      const card = el(
        "article",
        { class: "card" },
        el(
          "div",
          { class: "who" },
          avatar(p.name, p.color, p.avatar || "asleep", Boolean(p.working)),
          el(
            "div",
            { class: "names" },
            el(
              "div",
              { class: "line" },
              el("span", { class: "name", style: { color: nameColor(p.color) } }, p.name),
              // Every account has its Desktop app on Windows: Claude Desktop, or the ChatGPT app.
              el("button", { type: "button", class: "icon", style: { color: nameColor(p.color) }, title: `Open ${p.name}'s ${provider.title} Desktop`, "aria-label": `Open ${p.name}'s ${provider.title} Desktop`, onclick: run("desktop", { profile: p.name }, null) }, icon([provider.mark]))
            ),
            status && el("span", { class: `status small ${p.avatar === "error" ? "high" : "muted"}` }, status)
          )
        ),
        ...p.windows.map((w) => windowRow(p, w, now)),
        el("div", { class: "sides" }, where, button)
      );
      return card;
    };
    // One group per provider, Claude first; a header names each one only when there are two.
    const groups = Object.keys(providers).map((id) => ({ id, profiles: data.profiles.filter((p) => (p.provider || "claude") === id) })).filter((g) => g.profiles.length);
    const cards = data.profiles.map(cardOf);
    // A group's header says the plan with its seats ("team  2 seats") when every account of the
    // group has the same known plan, else the count; two spaces, as in the CLI.
    const summary = (g) => {
      const plans = new Set(g.profiles.map((p) => p.plan));
      const n = g.profiles.length;
      return plans.size === 1 && g.profiles[0].plan ? `${g.profiles[0].plan}  ${n} seat${n === 1 ? "" : "s"}` : `${n} account${n === 1 ? "" : "s"}`;
    };
    const blocks = groups.length > 1
      ? groups.flatMap((g) => [
          el("div", { class: "provider" }, icon([providers[g.id].mark]), el("span", {}, providers[g.id].title), el("span", { class: "muted" }, summary(g))),
          el("div", { class: "cards" }, ...g.profiles.map((p) => cards[data.profiles.indexOf(p)])),
        ])
      : [el("div", { class: "cards" }, ...cards)];
    const age = data.generatedAt ? `updated ${span(now - Date.parse(data.generatedAt))} ago` : "";
    // The other side being off is the one thing worth saying on the left: a switch doesn't reach it
    const off = data.peer && !data.peer.up ? `${data.peer.name} off` : "";
    // The strip and the cards in one block as wide as the cards side by side could be, so the
    // refresh lines up with the cards' switches.
    const sheet = el(
      "div",
      { class: "sheet" },
      el(
        "div",
        { class: "strip" },
        el("span", { class: "warn" }, off),
        el("span", { class: "line" }, age, el("button", { type: "button", class: `icon${busy("refresh")}`, title: "Ask for fresh numbers now", "aria-label": "Refresh", onclick: run("refresh", {}, "refresh") }, icon(["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"], true)))
      ),
      ...blocks,
      failure && el("p", { class: "message high" }, failure)
    );
    // The windows' labels in one column for every card, as wide as the longest (5h, 7d, Fable), as
    // in the CLI's usage, so the bars of Claude's and ChatGPT's accounts line up.
    sheet.style.setProperty("--label", `${Math.max(2, ...data.profiles.flatMap((p) => p.windows.map((w) => label(w).length)))}ch`);
    sheet.style.setProperty("--n", String(Math.max(1, ...groups.map((g) => g.profiles.length))));
    root.replaceChildren(sheet);
  }

  const root = document.getElementById("panel");
  if (!root) return;

  // The extension posts the data and runs the actions.
  const vscode = acquireVsCodeApi();
  const waiting = new Map();
  let next = 0;
  const act = (action, body) =>
    new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      vscode.postMessage({ type: "action", id, action, body });
    });
  addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "usage") render(root, m.data, { act, providers: m.providers });
    else if (m.type === "result" && waiting.has(m.id)) {
      waiting.get(m.id)(m.result);
      waiting.delete(m.id);
    } else if (m.type === "down") root.replaceChildren(el("p", { class: "message" }, m.detail));
  });
  vscode.postMessage({ type: "ready" });
})();
