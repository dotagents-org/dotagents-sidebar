import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

// The same file the view loads as a script
const { fromOsc, segments, separator } = createRequire(import.meta.url)("../media/cwd.js");
const { terminalCommand } = createRequire(import.meta.url)("../agent.js");

test("OSC 7 carries a file URL; OSC 9;9 the path, quoted or not", () => {
  assert.equal(fromOsc(7, "file://host/home/me/my%20project"), "/home/me/my project");
  assert.equal(fromOsc(7, "file://host/home/100%/x"), "/home/100%/x"); // not valid encoding: as it is
  assert.equal(fromOsc(7, "file:///C:/Users/me"), "C:/Users/me");
  assert.equal(fromOsc(9, '9;"C:\\Users\\me"'), "C:\\Users\\me");
  assert.equal(fromOsc(9, "9;C:\\Users\\me"), "C:\\Users\\me");
  assert.equal(fromOsc(9, "4;1;50"), null); // a progress report, not a folder
  assert.equal(fromOsc(7, "http://host/x"), null);
  assert.equal(fromOsc(0, "x"), null);
});

test("the title's path starts at home, else it is the whole path", () => {
  const where = { home: "/home/me" };
  // the workspace's own folder is a path too, not just its name
  assert.deepEqual(segments("/home/me/work", where), ["~", "work"]);
  assert.deepEqual(segments("/home/me/work/", where), ["~", "work"]);
  assert.deepEqual(segments("/home/me/work/app/src", where), ["~", "work", "app", "src"]);
  assert.deepEqual(segments("/home/me/worker", where), ["~", "worker"]);
  assert.deepEqual(segments("/home/mel/work", where), ["/home", "mel", "work"]); // a sibling that starts the same
  assert.deepEqual(segments("/home/me", where), ["~"]);
  assert.deepEqual(segments("/etc/nginx", where), ["/etc", "nginx"]);
  assert.deepEqual(segments("/", where), ["/"]);
  assert.deepEqual(segments("/home/me/a"), ["home", "me", "a"].map((s, i) => (i ? s : "/" + s)));
});

test("on Windows the title is the path as Windows shows it: a drive, backslashes, no ~", () => {
  const where = { home: "C:\\Users\\me" };
  assert.deepEqual(segments("C:\\Users\\me\\work\\app", where), ["C:", "Users", "me", "work", "app"]);
  assert.deepEqual(segments("C:/Users/me/work", where), ["C:", "Users", "me", "work"]); // from an OSC 7
  assert.deepEqual(segments("C:\\Users\\me", where), ["C:", "Users", "me"]);
  assert.deepEqual(segments("D:\\data\\x\\", where), ["D:", "data", "x"]);
  assert.deepEqual(segments("C:\\", where), ["C:\\"]); // a drive's root keeps its backslash
  assert.deepEqual(segments("\\\\wsl.localhost\\Ubuntu\\home\\me", where), ["\\\\wsl.localhost", "Ubuntu", "home", "me"]);
});

test("the parts are joined as the platform joins them", () => {
  assert.equal(separator("C:\\Users\\me"), "\\");
  assert.equal(separator("C:/Users/me"), "\\");
  assert.equal(separator("\\\\wsl.localhost\\Ubuntu"), "\\");
  assert.equal(separator("/home/me"), "/");
  assert.equal(separator("/mnt/c/Users/me"), "/"); // a Windows folder seen from Linux is a Linux path
});

test("bash, started as the terminal session starts it, reports the folder at each prompt", { skip: process.platform === "win32" }, () => {
  const { file, args } = terminalCommand("linux", { SHELL: "/bin/bash" });
  // A pty, as the host gives it, so bash is interactive and prints its prompt
  const script = `
import os, pty, sys, time, select
pid, fd = pty.fork()
if pid == 0:
    os.chdir("/tmp")
    os.execv(sys.argv[1], [sys.argv[1]] + sys.argv[2:])
out = b""
def read(t):
    global out
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try: out += os.read(fd, 4096)
            except OSError: return
read(1.5)
os.write(fd, b"cd /usr\\n"); read(1)
os.write(fd, b"exit\\n"); read(0.5)
sys.stdout.write(repr(out))
`;
  const result = spawnSync("python3", ["-I", "-c", script, file, ...args], { encoding: "utf8", env: { ...process.env, HOME: process.env.HOME } });
  const seen = [...result.stdout.matchAll(/\\x1b\]7;file:\/\/[^/]*(\/[^\\]*)\\x07/g)].map((m) => m[1]);
  assert.deepEqual(seen.slice(0, 1), ["/tmp"], result.stdout);
  assert.ok(seen.includes("/usr"), result.stdout);
  assert.ok(path.isAbsolute(args[1]));
});
