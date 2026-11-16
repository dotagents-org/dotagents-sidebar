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
    if (pr && pr.from) projection = el("span", { class: "note" }, `projection from ${hhmm(new Date(pr.from))}`);
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

  // Icons, drawn in the text's color. Claude's mark is simple-icons' (CC0); refresh is Lucide's
  // rotate-cw (ISC).
  const CLAUDE = "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z";
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
  function render(root, data, { act }) {
    shown = { root, data, act };
    const redraw = () => render(shown.root, shown.data, shown);
    const now = Date.now();
    const slots = data.slots || {};
    const sides = data.sides || Object.keys(slots);
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
    const cards = data.profiles.map((p) => {
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
      // The windows' labels in one column, as wide as the profile's longest (5h, 7d, Fable).
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
              el("button", { type: "button", class: "icon", style: { color: nameColor(p.color) }, title: `Open ${p.name}'s Claude Desktop`, "aria-label": `Open ${p.name}'s Claude Desktop`, onclick: run("desktop", { profile: p.name }, null) }, icon([CLAUDE]))
            ),
            status && el("span", { class: `status small ${p.avatar === "error" ? "high" : "muted"}` }, status)
          )
        ),
        ...p.windows.map((w) => windowRow(p, w, now)),
        el("div", { class: "sides" }, where, button)
      );
      card.style.setProperty("--label", `${Math.max(2, ...p.windows.map((w) => label(w).length))}ch`);
      return card;
    });
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
      el("div", { class: "cards" }, ...cards),
      failure && el("p", { class: "message high" }, failure)
    );
    sheet.style.setProperty("--n", String(cards.length || 1));
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
    if (m.type === "usage") render(root, m.data, { act });
    else if (m.type === "result" && waiting.has(m.id)) {
      waiting.get(m.id)(m.result);
      waiting.delete(m.id);
    } else if (m.type === "down") root.replaceChildren(el("p", { class: "message" }, m.detail));
  });
  vscode.postMessage({ type: "ready" });
})();
