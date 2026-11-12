import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const host = createRequire(import.meta.url)("../host.js");
const { connect, socketDir } = host;

// Every host a test starts is closed at the end, even when the test fails halfway
const started = [];
const createHost = async (options) => {
  const h = await host.createHost(options);
  started.push(h);
  return h;
};
after(() => Promise.all(started.map((h) => h.close())));

// A pty that records what it gets and lets the test play the agent
function fakePty() {
  const spawned = [];
  return {
    spawned,
    spawn(file, args, options) {
      const proc = { file, args, options, written: [], killed: false, size: [options.cols, options.rows], data: [], exits: [] };
      proc.write = (d) => (proc.written.push(d), proc.onWrite && proc.onWrite(d));
      proc.resize = (c, r) => (proc.size = [c, r]);
      proc.kill = () => {
        proc.killed = true;
        proc.exits.forEach((f) => f({ exitCode: 0 }));
      };
      proc.onData = (f) => proc.data.push(f);
      proc.onExit = (f) => proc.exits.push(f);
      proc.emit = (d) => proc.data.forEach((f) => f(d));
      proc.exit = (code) => proc.exits.forEach((f) => f({ exitCode: code }));
      spawned.push(proc);
      return proc;
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "agents-host-"));

// A client that collects what the host sends
async function client(socketPath) {
  const got = [];
  const channel = await connect(socketPath, (msg) => got.push(msg));
  const next = async (type) => {
    for (let i = 0; i < 100; i++) {
      const at = got.findIndex((m) => m.type === type);
      if (at >= 0) return got.splice(at, 1)[0];
      await wait(10);
    }
    throw new Error(`no ${type}`);
  };
  return { got, channel, next, send: (m) => channel.send(m) };
}

const create = { type: "create", id: "s1", file: "bash", args: ["-ic", "agent"], cwd: "/work", env: { A: "1" }, cols: 80, rows: 24, scrollback: 0 };

test("the host runs the agent, relays input and output, and survives its client", async () => {
  const dir = tmp();
  const pty = fakePty();
  const host = await createHost({ pty, socketPath: path.join(dir, "s"), grace: 1000 });
  const a = await client(host.socketPath);
  a.send(create);
  await wait(30);
  const proc = pty.spawned[0];
  assert.equal(proc.file, "bash");
  assert.deepEqual(proc.options.cwd, "/work");
  proc.emit("hello\r\n");
  assert.deepEqual(await a.next("output"), { type: "output", id: "s1", data: "hello\r\n" });
  a.send({ type: "input", id: "s1", data: "x" });
  a.send({ type: "resize", id: "s1", cols: 100, rows: 30 });
  await wait(30);
  assert.deepEqual(proc.written, ["x"]);
  assert.deepEqual(proc.size, [100, 30]);

  // The window reloads: the client goes away, the agent keeps running
  a.channel.close();
  await wait(50);
  proc.emit("while away\r\n");
  assert.equal(proc.killed, false);

  const b = await client(host.socketPath);
  b.send({ type: "snapshot" });
  const snap = await b.next("snapshot");
  assert.equal(snap.sessions.s1.running, true);
  assert.match(snap.sessions.s1.screen, /hello/);
  assert.match(snap.sessions.s1.screen, /while away/);
  b.channel.close();
  await host.close();
});

test("every piece of output is in the snapshot or after it, never in both", async () => {
  const dir = tmp();
  const pty = fakePty();
  const host = await createHost({ pty, socketPath: path.join(dir, "s"), grace: 1000 });
  const a = await client(host.socketPath);
  a.send({ ...create, scrollback: 1000 });
  await wait(30);
  const proc = pty.spawned[0];
  a.got.length = 0;
  // Output arrives before, and right after the host takes the request (the input that follows
  // it makes the fake agent print), while the screens are being serialized
  const tokens = Array.from({ length: 60 }, (_, i) => `t${i}x`);
  for (const token of tokens.slice(0, 20)) proc.emit(`${token}\r\n`);
  proc.onWrite = () => tokens.slice(20).forEach((token) => proc.emit(`${token}\r\n`));
  a.send({ type: "snapshot" });
  a.send({ type: "input", id: "s1", data: "go" });
  await wait(100);
  const at = a.got.findIndex((m) => m.type === "snapshot");
  assert.ok(at >= 0);
  const screen = a.got[at].sessions.s1.screen;
  const after = a.got.slice(at + 1).filter((m) => m.type === "output").map((m) => m.data).join("");
  for (const token of tokens) {
    const count = (screen.includes(token) ? 1 : 0) + (after.includes(token) ? 1 : 0);
    assert.equal(count, 1, token);
  }
  a.channel.close();
  await host.close();
});

test("an agent that exits stays as a screen, with its exit code, until it is closed", async () => {
  const dir = tmp();
  const pty = fakePty();
  const host = await createHost({ pty, socketPath: path.join(dir, "s"), grace: 1000 });
  const a = await client(host.socketPath);
  a.send(create);
  await wait(30);
  pty.spawned[0].exit(1);
  assert.deepEqual(await a.next("exit"), { type: "exit", id: "s1", exitCode: 1 });
  a.send({ type: "note", id: "s1", data: "[exited]" });
  a.send({ type: "snapshot" });
  const snap = await a.next("snapshot");
  assert.equal(snap.sessions.s1.running, false);
  assert.match(snap.sessions.s1.screen, /\[exited\]/);
  a.send({ type: "kill", id: "s1" });
  a.send({ type: "snapshot" });
  assert.deepEqual((await a.next("snapshot")).sessions, {});
  a.channel.close();
  await host.close();
});

test("with no client for the grace period, the host stops the agents and exits", async () => {
  const dir = tmp();
  const pty = fakePty();
  let exited = false;
  const host = await createHost({ pty, socketPath: path.join(dir, "s"), grace: 100, onExit: () => (exited = true) });
  const a = await client(host.socketPath);
  a.send(create);
  await wait(30);
  a.channel.close();
  await wait(250);
  assert.equal(pty.spawned[0].killed, true);
  assert.equal(exited, true);
  assert.equal(fs.existsSync(host.socketPath), false);
});

test("a client that comes back within the grace period keeps the agents", async () => {
  const dir = tmp();
  const pty = fakePty();
  const host = await createHost({ pty, socketPath: path.join(dir, "s"), grace: 200 });
  const a = await client(host.socketPath);
  a.send(create);
  await wait(30);
  a.channel.close();
  await wait(80);
  const b = await client(host.socketPath);
  await wait(250);
  assert.equal(pty.spawned[0].killed, false);
  b.channel.close();
  await host.close();
});

test("a second host on the same socket gives way to the first; a stale socket is replaced", async () => {
  const dir = tmp();
  const socketPath = path.join(dir, "s");
  const first = await createHost({ pty: fakePty(), socketPath, grace: 1000 });
  await assert.rejects(createHost({ pty: fakePty(), socketPath, grace: 1000 }), /already running/);
  await first.close();
  fs.writeFileSync(socketPath, ""); // left behind by a host that crashed
  const second = await createHost({ pty: fakePty(), socketPath, grace: 1000 });
  await second.close();
});

test("the socket folder is the user's alone", { skip: process.platform === "win32" }, () => {
  const base = tmp();
  const dir = socketDir({ XDG_RUNTIME_DIR: base });
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.chmodSync(dir, 0o755);
  assert.throws(() => socketDir({ XDG_RUNTIME_DIR: base }), /not private/);
});
