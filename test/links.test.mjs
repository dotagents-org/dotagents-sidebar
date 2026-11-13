import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// The same file the view loads as a script: the paths in a terminal line
const { findPaths, MAX_LINE, MAX_LINKS } = createRequire(import.meta.url)("../media/links.js");

// [the text of the link, the path, the line, the column] for each candidate
const found = (text) => findPaths(text).map((f) => [text.slice(f.start, f.end), f.path, f.line, f.column]);

test("a path with a slash or a file name with an extension, relative or absolute", () => {
  assert.deepEqual(found("Edited README.md and docs/commands.md."), [
    ["README.md", "README.md", undefined, undefined],
    ["docs/commands.md", "docs/commands.md", undefined, undefined],
  ]);
  assert.deepEqual(
    found("/home/me/x.txt, ~/y.md, ./z.js and ../w.ts").map((f) => f[1]),
    ["/home/me/x.txt", "~/y.md", "./z.js", "../w.ts"]
  );
});

test("the place after a path: :line, :line:column, (line,column), ', line N'", () => {
  assert.deepEqual(found("see src/a.ts:41 and src/b.ts:41:7"), [
    ["src/a.ts:41", "src/a.ts", 41, undefined],
    ["src/b.ts:41:7", "src/b.ts", 41, 7],
  ]);
  assert.deepEqual(found("test/a.mjs (12,4)"), [["test/a.mjs (12,4)", "test/a.mjs", 12, 4]]);
  assert.deepEqual(found('File "app.py", line 12'), [['"app.py", line 12', "app.py", 12, undefined]]);
});

test("a path with spaces only in double quotes", () => {
  assert.deepEqual(found('open "my notes/todo.md":3 now'), [['"my notes/todo.md":3', "my notes/todo.md", 3, undefined]]);
  assert.deepEqual(found("my notes/todo.md").map((f) => f[1]), ["notes/todo.md"], "without quotes, from the last space");
});

test("web links are the web's, file:// links and Windows paths are files", () => {
  assert.deepEqual(found("https://github.com/org/repo/blob/main/a.ts"), []);
  assert.deepEqual(found("file:///home/me/a.ts:9"), [["file:///home/me/a.ts:9", "file:///home/me/a.ts", 9, undefined]]);
  assert.deepEqual(found("C:\\Users\\me\\a.txt:5").map((f) => [f[1], f[2]]), [["C:\\Users\\me\\a.txt", 5]]);
});

test("versions, numbers and sentence marks are not paths", () => {
  assert.deepEqual(found("version 1.2.3, pi 3.14 and node 22.18"), []);
  assert.deepEqual(found("(see docs/a.md)").map((f) => f[1]), ["docs/a.md"], "the closing parenthesis is the sentence's");
});

test("long lines and many paths stay bounded", () => {
  assert.deepEqual(findPaths("a/b ".repeat(MAX_LINE)), []);
  assert.equal(findPaths(Array.from({ length: 30 }, (_, i) => `f${i}.ts`).join(" ")).length, MAX_LINKS);
});
