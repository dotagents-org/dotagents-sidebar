// How the sessions of a split share the view: a tree of halves, as herdr lays out its panes
// (layout.rs). A node is a session id, or { axis, ratio, a, b }: two nodes side by side ("row", a
// on the left) or one over the other ("column", a on top), a taking `ratio` of the space. Pure, so
// it is tested without a window.
//
// The leaves, in order, are the sessions of the split as the list shows them: a split inserts the
// new session right after (right, down) or before (left, up) the one it splits, and a reorder in
// the list relabels the leaves without changing the shape.
//
// Shared by the view (a script that declares agentLayout), the sessions' actions and the tests
// (CommonJS).

const agentLayout = (() => {
  const MIN = 0.1;
  const MAX = 0.9;
  // The deepest a split may sit: its path from the root has at most this many sides. A split that
  // would go deeper is refused, and a saved tree deeper than this is not taken back
  const DEPTH = 16;
  const clamp = (ratio) => Math.min(MAX, Math.max(MIN, ratio));

  function leaves(node) {
    return typeof node === "string" ? [node] : [...leaves(node.a), ...leaves(node.b)];
  }

  // How many splits there are above `id` (the path of a split that splits it); -1 when not there
  function depth(node, id) {
    if (typeof node === "string") return node === id ? 0 : -1;
    const below = Math.max(depth(node.a, id), depth(node.b, id));
    return below < 0 ? -1 : below + 1;
  }

  // The tree without its ratios: what a dragged border's path means. A border is dragged in the
  // page while the tree may change in the extension (a session closed), so a resize names the
  // shape it was dragged in
  function shape(node) {
    return typeof node === "string" ? node : `${node.axis}(${shape(node.a)},${shape(node.b)})`;
  }

  // `target` becomes two halves, the new session `id` on the side `dir` says
  function insert(node, target, id, dir) {
    if (node === target) {
      const axis = dir === "left" || dir === "right" ? "row" : "column";
      const after = dir === "right" || dir === "down";
      return { axis, ratio: 0.5, a: after ? target : id, b: after ? id : target };
    }
    if (typeof node === "string") return node;
    return { ...node, a: insert(node.a, target, id, dir), b: insert(node.b, target, id, dir) };
  }

  // Without `id`: its sibling takes its parent's place, every other split as it was. Null when
  // nothing is left
  function remove(node, id) {
    if (typeof node === "string") return node === id ? null : node;
    const a = remove(node.a, id);
    const b = remove(node.b, id);
    if (!a) return b;
    if (!b) return a;
    return a === node.a && b === node.b ? node : { ...node, a, b };
  }

  // The same shape and ratios, with the leaves in the order of `ids`
  function relabel(node, ids) {
    let i = 0;
    const walk = (n) => (typeof n === "string" ? ids[i++] : { ...n, a: walk(n.a), b: walk(n.b) });
    return walk(node);
  }

  // The split at `path` (its sides from the root, "a" or "b") takes `ratio`; the same node when
  // there is none
  function setRatio(node, path, ratio) {
    if (typeof node === "string" || !Number.isFinite(ratio)) return node;
    if (!path.length) return { ...node, ratio: clamp(ratio) };
    const [side, ...rest] = path;
    if (side !== "a" && side !== "b") return node;
    const child = setRatio(node[side], rest, ratio);
    return child === node[side] ? node : { ...node, [side]: child };
  }

  // Sessions side by side in equal parts: a split saved before the tree, as it showed then. Halved
  // in the middle each time, so it stays shallow and every ratio is between a third and a half
  function row(ids) {
    if (ids.length === 1) return ids[0];
    const half = Math.floor(ids.length / 2);
    return { axis: "row", ratio: half / ids.length, a: row(ids.slice(0, half)), b: row(ids.slice(half)) };
  }

  // A tree read back from storage, when it is one with exactly `ids` as its leaves; else null
  function valid(node, ids, depth = 0) {
    const ok = (n, d) =>
      typeof n === "string" ||
      (n !== null &&
        typeof n === "object" &&
        d < DEPTH + 1 &&
        (n.axis === "row" || n.axis === "column") &&
        Number.isFinite(n.ratio) &&
        ok(n.a, d + 1) &&
        ok(n.b, d + 1));
    if (!ok(node, depth)) return null;
    const found = leaves(node);
    if (found.length !== ids.length || new Set(found).size !== found.length || !found.every((id) => ids.includes(id))) return null;
    const fix = (n) => (typeof n === "string" ? n : { axis: n.axis, ratio: clamp(n.ratio), a: fix(n.a), b: fix(n.b) });
    return fix(node);
  }

  return { MIN, MAX, DEPTH, leaves, depth, shape, insert, remove, relabel, setRatio, row, valid };
})();
if (typeof module === "object") module.exports = { ...agentLayout };
