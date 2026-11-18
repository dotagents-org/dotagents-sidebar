import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const { mask, format, writer } = createRequire(import.meta.url)("../src/log.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-logs-"));
const SECRETS = ["sk-ant-oat01-AbCdEf_123-xyz", "sk-ant-ort01-QRSTUV987", "eyJhbGciOiJSUzI1NiJ9.payload.sig", "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA"];

test("a token is masked however it is written, as in the core", () => {
  const [oauth, refresh, jwt, header] = SECRETS;
  for (const text of [`login ${oauth}`, `{"accessToken":"${oauth}","refreshToken":"${refresh}"}`, `x-dotagents-token: ${header}`, `Authorization: Bearer ${jwt}`]) {
    const masked = mask(text);
    for (const secret of SECRETS) assert.ok(!masked.includes(secret), masked);
  }
  assert.equal(mask("spawn bash ENOENT"), "spawn bash ENOENT");
});

test("no token reaches the file, and a line is the core's format", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = writer("host", dir);
  write("error", "spawn", `claude --token ${SECRETS[0]}\n{"refreshToken":"${SECRETS[1]}"}`);
  write("error", "host", new Error(`Bearer ${SECRETS[2]}`));
  const text = fs.readFileSync(path.join(dir, "host.log"), "utf8");
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} is in the log`);
  assert.equal(format("info", "host", "started\n  pid 1", new Date("2026-11-13T15:53:52.881Z")), "2026-11-13T15:53:52.881Z info host: started\n  pid 1\n");
});

test("a file past 1 MB becomes .1 and starts again; a log that can't be written doesn't throw", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "sidebar.log"), "a".repeat(1024 * 1024 + 1));
  writer("sidebar", dir)("info", "extension", "after");
  assert.equal(fs.statSync(path.join(dir, "sidebar.log.1")).size, 1024 * 1024 + 1);
  assert.match(fs.readFileSync(path.join(dir, "sidebar.log"), "utf8"), /info extension: after\n$/);
  const blocker = path.join(dir, "file");
  fs.writeFileSync(blocker, "x");
  assert.doesNotThrow(() => writer("sidebar", path.join(blocker, "logs"))("error", "x", "nowhere"));
});
