import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { PROVIDERS: providers } = require("../../src/accounts/providers.js");
const accounts = require("../../src/accounts/accounts.js");
const root = path.join(import.meta.dirname, "..", "..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");

// The panel's DOM operations, with avatars left to their own renderer.
function panel() {
  const node = () => ({
    children: [], attributes: {}, style: { setProperty() {} },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, listener) { this.listeners = { ...this.listeners, [name]: listener }; },
  });
  const host = node();
  const posted = [];
  let message;
  const context = vm.createContext({
    window: { dotagentsAvatar: { mount() {} } },
    document: {
      body: { classList: { contains: (name) => name === "vscode-light" } },
      getElementById: () => host,
      createElement: node,
      createElementNS: node,
    },
    getComputedStyle: () => ({ getPropertyValue: () => "56" }),
    acquireVsCodeApi: () => ({ postMessage: (msg) => posted.push(msg) }),
    addEventListener: (name, listener) => { if (name === "message") message = listener; },
  });
  vm.runInContext(source("webview/accounts/panel.js"), context);
  return { host, context, posted, send: (data) => message({ data }), render: (data) => message({ data: { type: "usage", data, providers: accounts.panelProviders } }) };
}

const flatten = (node) => typeof node === "object" ? [node, ...node.children.flatMap(flatten)] : [node];

test("each group names its plan as the product does: team is Claude Team and ChatGPT Business", () => {
  const view = panel();
  const profile = (name, provider) => ({ name, provider, plan: "team", color: "#123456", avatar: "asleep", state: "no-data", windows: [] });
  view.render({ profiles: [profile("work", "claude"), profile("personal", "claude"), profile("hopper", "chatgpt"), profile("dijkstra", "chatgpt")], slots: {}, current: {}, sides: [] });
  const nodes = flatten(view.host);
  assert.ok(nodes.includes("Team  2 seats"), "Claude's group");
  assert.ok(nodes.includes("Business  2 seats"), "ChatGPT's group");
  assert.equal(nodes.includes("team  2 seats"), false);
});

test("the extension and panel share account labels and marks, while sessions keep their agent names", () => {
  const view = panel();
  assert.deepEqual(Object.keys(accounts.panelProviders), Object.keys(providers));
  assert.deepEqual(Object.values(providers).map((p) => p.title), ["Claude", "ChatGPT"]);
  const { AGENTS } = require("../../src/sessions/agent.js");
  assert.deepEqual(Object.values(AGENTS).map((a) => a.name), ["Claude Code", "Codex"]);

  const saved = providers.chatgpt.title;
  const savedPanel = accounts.panelProviders.chatgpt.title;
  try {
    // Changing the single table must reach both consumers, without changing their code.
    providers.chatgpt.title = "ChatGPT test";
    accounts.panelProviders.chatgpt.title = providers.chatgpt.title;
    const data = {
      profiles: Object.keys(providers).map((provider) => ({ provider, name: provider, color: "#123456", avatar: "asleep", state: "no-data", windows: [] })),
      slots: {}, current: {}, sides: [],
    };
    assert.equal(accounts.pickItems(data)[1].description, "ChatGPT test");
    assert.equal(accounts.groupsFor(data)[1].parts[0].text, `$(${providers.chatgpt.icon}) chatgpt`);
    view.render(data);
    const nodes = flatten(view.host);
    assert.ok(nodes.includes("ChatGPT test"));
    // Every account's mark opens its Desktop app, the ChatGPT app for a ChatGPT one.
    assert.ok(nodes.some((n) => n.attributes?.title === "Open chatgpt's ChatGPT test Desktop"));
    assert.ok(nodes.some((n) => n.attributes?.title === "Open claude's Claude Desktop"));
    for (const p of Object.values(providers)) assert.ok(nodes.some((n) => n.attributes?.d === p.mark), p.title);
  } finally {
    providers.chatgpt.title = saved;
    accounts.panelProviders.chatgpt.title = savedPanel;
  }
});

test("the webview receives the shared provider table with usage", () => {
  assert.match(source("src/accounts/accounts.js"), /providers: panelProviders/);
});

test("after a switch the panel shows what to do next, in the core's words, until the next action", async () => {
  const view = panel();
  const profile = (name) => ({ name, provider: "chatgpt", plan: "team", color: "#123456", avatar: "asleep", state: "no-data", windows: [] });
  view.render({ profiles: [profile("hopper"), profile("dijkstra")], slots: { chatgpt: { WSL: "hopper" } }, current: {}, sides: ["WSL"] });
  const button = flatten(view.host).find((n) => typeof n === "object" && n.listeners?.click && n.children.includes("switch"));
  button.listeners.click();
  const { id } = view.posted.at(-1);
  const next = "Codex sessions already open stay on the old account until you restart them.";
  view.send({ type: "result", id, result: { ok: true, detail: "now dijkstra", next } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(flatten(view.host).includes(next));
  button.listeners.click();
  assert.equal(flatten(view.host).includes(next), false);
  // This side's slot changed, the other side failed: the error and what to do here, both
  const again = view.posted.at(-1).id;
  view.send({ type: "result", id: again, result: { ok: false, detail: "Windows: unreachable", next } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(flatten(view.host).includes("Windows: unreachable"));
  assert.ok(flatten(view.host).includes(next));
});
