// What dragging a session in the list does, worked out as the terminal panel's tabs do it
// (TerminalGroupService.moveGroup and moveGroupToEnd in VS Code). Pure, so it is tested without a
// window.
//
// The list is a run of groups: sessions that show together are neighbors. Dropping a session on
// another moves its whole group next to the other's group, after it when the group was before, or
// before it when the group was after. Dropping on a session of its own group reorders inside the
// group. Dropping below the last session sends the group to the end. Dragging never joins or
// leaves a group in the terminal panel (that is its Join and Unsplit commands); here that is a drop
// with Shift: on a session to join its group, below the last one to leave the group it is in.
//
// Shared by the view (a script that declares agentDrag), the sessions' actions and the tests
// (CommonJS).

const agentDrag = (() => {
  // The list as groups: runs of neighbors that share a group
  function groups(sessions) {
    const out = [];
    for (const s of sessions) {
      const last = out[out.length - 1];
      if (last && last[0].group === s.group) last.push(s);
      else out.push([s]);
    }
    return out;
  }

  const same = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);

  // The list after dropping `id` on `targetId`; the same array when nothing changes
  function dropOrder(sessions, id, targetId) {
    const all = groups(sessions);
    const from = all.findIndex((g) => g.some((s) => s.id === id));
    const to = all.findIndex((g) => g.some((s) => s.id === targetId));
    if (from < 0 || to < 0) return sessions;
    let next;
    if (from === to) {
      const group = all[from];
      const was = group.findIndex((s) => s.id === id);
      const over = group.findIndex((s) => s.id === targetId);
      if (was === over) return sessions;
      const rest = group.filter((s) => s.id !== id);
      const at = rest.findIndex((s) => s.id === targetId) + (was < over ? 1 : 0);
      next = all.map((g, i) => (i === from ? [...rest.slice(0, at), group[was], ...rest.slice(at)] : g));
    } else {
      const rest = all.filter((_, i) => i !== from);
      const at = rest.indexOf(all[to]) + (from < to ? 1 : 0);
      next = [...rest.slice(0, at), all[from], ...rest.slice(at)];
    }
    const flat = next.flat();
    return same(flat, sessions) ? sessions : flat;
  }

  // The list after sending `id`'s group to the end
  function endOrder(sessions, id) {
    const all = groups(sessions);
    const from = all.findIndex((g) => g.some((s) => s.id === id));
    if (from < 0 || from === all.length - 1) return sessions;
    return [...all.filter((_, i) => i !== from).flat(), ...all[from]];
  }

  // Where the line goes for a drop on `targetId`: after the target's group when the dragged group
  // is before it, before it when after (in the group itself, next to the target)
  function line(sessions, id, targetId) {
    const all = groups(sessions);
    const from = all.findIndex((g) => g.some((s) => s.id === id));
    const to = all.findIndex((g) => g.some((s) => s.id === targetId));
    if (from === to) {
      const group = all[from];
      return { id: targetId, where: group.findIndex((s) => s.id === id) < group.findIndex((s) => s.id === targetId) ? "after" : "before" };
    }
    return from < to ? { id: all[to].at(-1).id, where: "after" } : { id: all[to][0].id, where: "before" };
  }

  // The sessions that move with a drop on `targetId` (none: a drop below the last one): the
  // dragged session alone inside its group, else its whole group
  function moving(sessions, id, targetId) {
    const session = sessions.find((s) => s.id === id);
    const target = sessions.find((s) => s.id === targetId);
    if (!session) return [];
    return target && target.group === session.group ? [id] : sessions.filter((s) => s.group === session.group).map((s) => s.id);
  }

  // What a drop on `targetId` does, or null when it changes nothing:
  //   { message: { type: "drop", id, target }, mark: { id, where } }   a line before or after a row
  //   { message: { type: "join", id, target }, mark: { id, where: "into" } }   with `join` (Shift)
  function plan(sessions, id, targetId, join) {
    const session = sessions.find((s) => s.id === id);
    const target = sessions.find((s) => s.id === targetId);
    if (!session || !target || id === targetId) return null;
    if (join) return session.group === target.group ? null : { message: { type: "join", id, target: targetId }, mark: { id: targetId, where: "into" } };
    if (dropOrder(sessions, id, targetId) === sessions) return null;
    return { message: { type: "drop", id, target: targetId }, mark: line(sessions, id, targetId) };
  }

  // The same for a drop below the last session. With `leave` (Shift) a session that is in a split
  // leaves it, to a group of its own at the end
  function planEnd(sessions, id, leave) {
    const session = sessions.find((s) => s.id === id);
    const mark = { id: sessions.at(-1)?.id, where: "after" };
    if (leave && session && sessions.filter((s) => s.group === session.group).length > 1) return { message: { type: "unsplit", id }, mark };
    if (endOrder(sessions, id) === sessions) return null;
    return { message: { type: "dropEnd", id }, mark };
  }

  return { groups, dropOrder, endOrder, moving, plan, planEnd };
})();
if (typeof module === "object") module.exports = { ...agentDrag };
