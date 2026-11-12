// The process that owns the agents. VS Code stops the extension on every window reload, and
// the agents it started would stop with it; this process doesn't, so an agent keeps working
// while the window reloads and the view picks its screen up again afterwards. It is VS Code's
// own design for the integrated terminal (the pty host), for the view's agents.
//
// The extension talks to it over a socket, in lines of JSON. It keeps a headless copy of each
// agent's screen to redraw a view that comes back. With no extension connected for the grace
// period (the window was closed, not reloaded), it stops the agents and exits.

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

const GRACE = 60 * 1000;

// node-pty ships inside VS Code (node_modules on the server, asar.unpacked on desktop)
function loadPty(appRoot) {
  const candidates = [
    path.join(appRoot, "node_modules", "node-pty"),
    path.join(appRoot, "node_modules.asar.unpacked", "node-pty"),
    path.join(appRoot, "node_modules.asar", "node-pty"),
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  throw new Error(`node-pty not found in VS Code:\n${errors.join("\n")}`);
}

// Whoever reaches the socket types into the agents, so it lives in a folder only the user can open
function socketDir(env = process.env) {
  const uid = process.getuid();
  const dir = path.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `dotagents-sidebar-${uid}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) throw new Error(`${dir} is not private`);
  return dir;
}

function socketPath(key) {
  if (process.platform === "win32") return `\\\\.\\pipe\\dotagents-sidebar-${os.userInfo().username}-${key}`;
  return path.join(socketDir(), `${key}.sock`);
}

// Lines of JSON over a socket
function channel(socket, onMessage, onClose) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      onMessage(msg);
    }
  });
  socket.on("error", () => {}); // a closed peer; "close" follows
  socket.on("close", () => onClose && onClose());
  return {
    send: (msg) => {
      if (!socket.destroyed) socket.write(JSON.stringify(msg) + "\n");
    },
    close: () => socket.end(),
    destroy: () => socket.destroy(),
  };
}

function connect(socketPath, onMessage, onClose) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(channel(socket, onMessage, onClose));
    });
  });
}

function listen(server, socketPath) {
  const once = () =>
    new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
  return once().catch(async (err) => {
    if (err.code !== "EADDRINUSE") throw err;
    const alive = await connect(socketPath, () => {}).then(
      (c) => (c.close(), true),
      () => false
    );
    if (alive) throw new Error(`a host is already running on ${socketPath}`);
    fs.unlinkSync(socketPath); // left behind by a host that crashed
    return once();
  });
}

async function createHost({ pty, socketPath, grace = GRACE, onExit = () => {} }) {
  const sessions = new Map(); // id -> { proc, screen, serializer, exitCode }
  const clients = new Set(); // { channel, queue }: while a snapshot is taken, its messages wait in queue
  let timer;
  let closed = false;

  const broadcast = (msg) => {
    for (const client of clients) client.queue ? client.queue.push(msg) : client.channel.send(msg);
  };

  function write(id, data) {
    sessions.get(id).screen.write(data);
    broadcast({ type: "output", id, data });
  }

  function stop(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    const { proc } = session;
    session.proc = undefined;
    if (proc) proc.kill();
    session.screen.dispose();
  }

  function create(msg) {
    stop(msg.id);
    const screen = new Terminal({ cols: msg.cols, rows: msg.rows, scrollback: msg.scrollback, allowProposedApi: true });
    const serializer = new SerializeAddon();
    screen.loadAddon(serializer);
    const session = { proc: undefined, screen, serializer, exitCode: null };
    sessions.set(msg.id, session);
    let proc;
    try {
      proc = pty.spawn(msg.file, msg.args, { name: "xterm-256color", cols: msg.cols, rows: msg.rows, cwd: msg.cwd, env: msg.env });
    } catch (err) {
      write(msg.id, `\r\n${err.message.replace(/\n/g, "\r\n")}\r\n`);
      session.exitCode = -1;
      broadcast({ type: "exit", id: msg.id, exitCode: -1 });
      return;
    }
    session.proc = proc;
    proc.onData((data) => {
      if (session.proc === proc) write(msg.id, data);
    });
    proc.onExit(({ exitCode }) => {
      if (session.proc !== proc) return;
      session.proc = undefined;
      session.exitCode = exitCode;
      broadcast({ type: "exit", id: msg.id, exitCode });
    });
  }

  // Every screen as it is now. The client's other messages wait, so output that arrives
  // meanwhile reaches it after the snapshot, once
  function snapshot(client) {
    client.queue = client.queue || [];
    const taken = [...sessions].map(
      ([id, s]) =>
        new Promise((resolve) =>
          s.screen.write("", () => resolve([id, { screen: s.serializer.serialize(), running: !!s.proc, exitCode: s.exitCode }]))
        )
    );
    Promise.all(taken).then((list) => {
      const queue = client.queue;
      client.queue = null;
      client.channel.send({ type: "snapshot", sessions: Object.fromEntries(list) });
      for (const msg of queue) client.channel.send(msg);
    });
  }

  function handle(client, msg) {
    const session = sessions.get(msg.id);
    switch (msg.type) {
      case "create":
        create(msg);
        break;
      case "input":
        if (session && session.proc) session.proc.write(msg.data);
        break;
      case "resize":
        if (!session) break;
        session.screen.resize(msg.cols, msg.rows);
        if (session.proc) session.proc.resize(msg.cols, msg.rows);
        break;
      case "note": // a line from the extension, kept on the screen like the agent's output
        if (session) write(msg.id, msg.data);
        break;
      case "kill":
        stop(msg.id);
        break;
      case "snapshot":
        snapshot(client);
        break;
    }
  }

  const server = net.createServer((socket) => {
    clearTimeout(timer);
    const client = { channel: undefined, queue: null };
    client.channel = channel(
      socket,
      (msg) => handle(client, msg),
      () => {
        clients.delete(client);
        if (!clients.size && !closed) timer = setTimeout(close, grace);
      }
    );
    clients.add(client);
  });

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    for (const id of [...sessions.keys()]) stop(id);
    for (const client of clients) client.channel.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (process.platform !== "win32") fs.rmSync(socketPath, { force: true });
    onExit();
  }

  await listen(server, socketPath);
  timer = setTimeout(close, grace); // started, but nobody came
  return { socketPath, close };
}

module.exports = { GRACE, connect, createHost, loadPty, socketDir, socketPath };

// Started by the extension: node host.js <socket> <VS Code's appRoot>
if (require.main === module) {
  const [socket, appRoot] = process.argv.slice(2);
  let pty;
  try {
    pty = loadPty(appRoot);
  } catch (err) {
    pty = {
      spawn() {
        throw err;
      },
    };
  }
  createHost({ pty, socketPath: socket, onExit: () => process.exit(0) }).catch(() => process.exit(1));
}
