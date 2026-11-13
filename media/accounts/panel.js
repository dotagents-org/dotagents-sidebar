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
    window.dotagentsAvatar.mount(canvas, { who: name, color, state, working, size: 40 });
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
  const CLAUDE = "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
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
    const where = data.peer && !data.peer.up ? `${data.peer.name} off` : sides.join(" and ");
    const count = `${data.profiles.length} profile${data.profiles.length === 1 ? "" : "s"}`;
    // The brand, the cards and the foot in one block as wide as the cards side by side could be,
    // so the refresh lines up with the cards' switches.
    const sheet = el(
      "div",
      { class: "sheet" },
      el("div", { class: "top" }, el("span", { class: "seal" }, " dotagents "), el("span", { class: "muted" }, count)),
      el("div", { class: "cards" }, ...cards),
      failure && el("p", { class: "message high" }, failure),
      el(
        "div",
        { class: "foot" },
        el("span", {}, where),
        el("span", { class: "line" }, age, el("button", { type: "button", class: `icon${busy("refresh")}`, title: "Ask for fresh numbers now", "aria-label": "Refresh", onclick: run("refresh", {}, "refresh") }, icon(["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"], true)))
      )
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
