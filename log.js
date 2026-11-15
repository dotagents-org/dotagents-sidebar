// The sidebar's logs, in the format dotagents-core describes (its docs/logs.md): one text file per
// process in <stateDir>/logs/, sidebar.log for the extension and host.log for the host process,
// so an error on either side of the machine can be read from files. A copy of the core's writer,
// since this has no build and doesn't import from it. Writing never fails the caller, and
// credentials never get in: every line is masked first.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { stateDir } = require("./accounts.js");

// Past this size a file becomes <name>.log.1, replacing the one before, and starts again.
const ROTATE_AT = 1024 * 1024;

// A token, key or header's value, however it is written.
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]"],
  [/((?:access|refresh)Token["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]"],
  [/(x-dotagents-token["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]"],
];

const mask = (text) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), text);

// `2026-11-13T15:53:52.881Z error spawn: the message`, and what follows (a stack) under it, indented.
function format(level, source, message, now = new Date()) {
  const body = message instanceof Error ? message.stack || message.message : String(message);
  const [first, ...rest] = mask(body).replace(/\r/g, "").trimEnd().split("\n");
  return [`${now.toISOString()} ${level} ${source}: ${first}`, ...rest.map((l) => `  ${l.trim()}`)].join("\n") + "\n";
}

// A writer for one file: write(level, source, message), level "info" or "error".
function writer(name, dir = path.join(stateDir(), "logs")) {
  const file = path.join(dir, `${name}.log`);
  return (level, source, message) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(file).size > ROTATE_AT) {
          fs.rmSync(`${file}.1`, { force: true });
          fs.renameSync(file, `${file}.1`);
        }
      } catch {
        // no file yet
      }
      fs.appendFileSync(file, format(level, source, message), { mode: 0o600 });
    } catch {
      // a log that can't be written is not worth stopping for
    }
  };
}

module.exports = { mask, format, writer };
