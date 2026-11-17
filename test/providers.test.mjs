import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { PROVIDERS: providers } = require("../providers.js");
const accounts = require("../accounts.js");
const root = path.join(import.meta.dirname, "..");
const source = (name) => fs.readFileSync(path.join(root, name), "utf8");

// The panel's DOM operations, with avatars left to their own renderer.
function panel() {
  const node = () => ({
    children: [], attributes: {}, style: { setProperty() {} },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener() {},
  });
  const host = node();
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
    acquireVsCodeApi: () => ({ postMessage() {} }),
    addEventListener: (name, listener) => { if (name === "message") message = listener; },
  });
  vm.runInContext(source("media/accounts/panel.js"), context);
  return { host, context, render: (data) => message({ data: { type: "usage", data, providers: accounts.panelProviders } }) };
}

const flatten = (node) => typeof node === "object" ? [node, ...node.children.flatMap(flatten)] : [node];

test("the extension and panel share account labels and marks, while sessions keep their agent names", () => {
  const view = panel();
  assert.deepEqual(Object.keys(accounts.panelProviders), Object.keys(providers));
  assert.deepEqual(Object.values(providers).map((p) => p.title), ["Claude", "ChatGPT"]);
  const { AGENTS } = require("../agent.js");
  assert.deepEqual(Object.values(AGENTS).map((a) => a.name), ["Claude Code", "Codex"]);

  const saved = providers.codex.title;
  const savedPanel = accounts.panelProviders.codex.title;
  try {
    // Changing the single table must reach both consumers, without changing their code.
    providers.codex.title = "ChatGPT test";
    accounts.panelProviders.codex.title = providers.codex.title;
    const data = {
      profiles: Object.keys(providers).map((provider) => ({ provider, name: provider, color: "#123456", avatar: "asleep", state: "no-data", windows: [] })),
      slots: {}, current: {}, sides: [],
    };
    assert.equal(accounts.pickItems(data)[1].description, "ChatGPT test");
    assert.equal(accounts.groupsFor(data)[1].parts[0].text, `$(${providers.codex.icon}) codex`);
    view.render(data);
    const nodes = flatten(view.host);
    assert.ok(nodes.includes("ChatGPT test"));
    // Every account's mark opens its Desktop app, the ChatGPT app for a ChatGPT one.
    assert.ok(nodes.some((n) => n.attributes?.title === "Open codex's ChatGPT test Desktop"));
    assert.ok(nodes.some((n) => n.attributes?.title === "Open claude's Claude Desktop"));
    for (const p of Object.values(providers)) assert.ok(nodes.some((n) => n.attributes?.d === p.mark), p.title);
  } finally {
    providers.codex.title = saved;
    accounts.panelProviders.codex.title = savedPanel;
  }
});

test("the webview receives the shared provider table with usage", () => {
  assert.match(source("accounts.js"), /providers: panelProviders/);
});
