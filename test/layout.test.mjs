import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { DEPTH, leaves, depth, shape, insert, remove, relabel, setRatio, row, valid } = createRequire(import.meta.url)("../media/layout.js");

test("insert splits a session in two, the new one on the side asked for", () => {
  assert.deepEqual(insert("s1", "s1", "s2", "right"), { axis: "row", ratio: 0.5, a: "s1", b: "s2" });
  assert.deepEqual(insert("s1", "s1", "s2", "left"), { axis: "row", ratio: 0.5, a: "s2", b: "s1" });
  assert.deepEqual(insert("s1", "s1", "s2", "down"), { axis: "column", ratio: 0.5, a: "s1", b: "s2" });
  assert.deepEqual(insert("s1", "s1", "s2", "up"), { axis: "column", ratio: 0.5, a: "s2", b: "s1" });
  const nested = insert({ axis: "row", ratio: 0.3, a: "s1", b: "s2" }, "s2", "s3", "down");
  assert.deepEqual(nested, { axis: "row", ratio: 0.3, a: "s1", b: { axis: "column", ratio: 0.5, a: "s2", b: "s3" } });
  assert.deepEqual(leaves(nested), ["s1", "s2", "s3"]);
});

test("remove gives the space to the sibling and leaves the rest alone", () => {
  const tree = { axis: "row", ratio: 0.3, a: "s1", b: { axis: "column", ratio: 0.6, a: "s2", b: "s3" } };
  assert.deepEqual(remove(tree, "s2"), { axis: "row", ratio: 0.3, a: "s1", b: "s3" });
  assert.deepEqual(remove(tree, "s1"), { axis: "column", ratio: 0.6, a: "s2", b: "s3" });
  assert.equal(remove(tree, "s9"), tree);
  assert.equal(remove("s1", "s1"), null);
});

test("relabel keeps the shape with the leaves in a new order", () => {
  const tree = { axis: "row", ratio: 0.3, a: "s1", b: { axis: "column", ratio: 0.6, a: "s2", b: "s3" } };
  assert.deepEqual(relabel(tree, ["s3", "s1", "s2"]), { axis: "row", ratio: 0.3, a: "s3", b: { axis: "column", ratio: 0.6, a: "s1", b: "s2" } });
});

test("setRatio follows the path, keeps the ratio between 0.1 and 0.9 and ignores a wrong path", () => {
  const tree = { axis: "row", ratio: 0.5, a: "s1", b: { axis: "column", ratio: 0.5, a: "s2", b: "s3" } };
  assert.equal(setRatio(tree, ["b"], 0.25).b.ratio, 0.25);
  assert.equal(setRatio(tree, [], 2).ratio, 0.9);
  assert.equal(setRatio(tree, [], -1).ratio, 0.1);
  assert.equal(setRatio(tree, ["a"], 0.3), tree);
  assert.equal(setRatio(tree, ["c"], 0.3), tree);
  assert.equal(setRatio(tree, [], Infinity), tree);
});

// The share of the whole each leaf gets
function shares(node, of = 1, out = {}) {
  if (typeof node === "string") out[node] = of;
  else {
    shares(node.a, of * node.ratio, out);
    shares(node.b, of * (1 - node.ratio), out);
  }
  return out;
}

test("row lays sessions side by side in equal parts, however many", () => {
  assert.equal(row(["s1"]), "s1");
  for (const n of [2, 3, 4, 7, 11, 40]) {
    const ids = Array.from({ length: n }, (_, i) => `s${i + 1}`);
    const tree = row(ids);
    assert.deepEqual(leaves(tree), ids);
    for (const share of Object.values(shares(tree))) assert.ok(Math.abs(share - 1 / n) < 1e-9, `${n}: ${share}`);
    assert.deepEqual(valid(tree, ids), tree); // a migrated tree is one restore keeps
  }
});

test("depth counts the splits above a session, and shape is the tree without its ratios", () => {
  const tree = { axis: "row", ratio: 0.3, a: "s1", b: { axis: "column", ratio: 0.6, a: "s2", b: "s3" } };
  assert.equal(depth(tree, "s1"), 1);
  assert.equal(depth(tree, "s3"), 2);
  assert.equal(depth(tree, "s9"), -1);
  assert.equal(depth("s1", "s1"), 0);
  assert.equal(shape(tree), "row(s1,column(s2,s3))");
  assert.equal(shape(setRatio(tree, ["b"], 0.2)), shape(tree));
});

test("valid takes back a tree as deep as a split may go, and no deeper", () => {
  let tree = "s0";
  for (let i = 1; i <= DEPTH + 2; i++) tree = insert(tree, `s${i - 1}`, `s${i}`, "down");
  // The deepest split, over the last two sessions, has a path of DEPTH + 1 sides
  assert.equal(depth(tree, `s${DEPTH + 2}`), DEPTH + 2);
  assert.equal(valid(tree, leaves(tree)), null);
  const ok = remove(tree, `s${DEPTH + 2}`); // its deepest split's path has DEPTH sides
  assert.deepEqual(valid(ok, leaves(ok)), ok);
});

test("valid takes a saved tree only when it is one, with exactly the group's sessions", () => {
  const tree = { axis: "row", ratio: 0.5, a: "s1", b: "s2" };
  assert.deepEqual(valid(tree, ["s1", "s2"]), tree);
  assert.deepEqual(valid({ ...tree, ratio: 5 }, ["s1", "s2"]), { ...tree, ratio: 0.9 });
  assert.deepEqual(valid({ ...tree, extra: 1 }, ["s1", "s2"]), tree); // only what a tree has
  assert.equal(valid(tree, ["s1", "s2", "s3"]), null);
  assert.equal(valid({ ...tree, b: "s1" }, ["s1", "s2"]), null);
  assert.equal(valid({ ...tree, axis: "diagonal" }, ["s1", "s2"]), null);
  assert.equal(valid({ ...tree, ratio: "half" }, ["s1", "s2"]), null);
  assert.equal(valid(undefined, ["s1", "s2"]), null);
  assert.equal(valid(null, ["s1", "s2"]), null);
});
