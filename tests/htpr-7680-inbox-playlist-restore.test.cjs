const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load: loadSource } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");

const load = (relativePath) => loadSource(relativePath, {});

const { buildInboxTasksPlaylist, pickInboxPlaylistSplit, inboxPlaylistHoldsTask } = load("src/lib/inbox/inboxTasksPlaylist.ts");

const note = (projectId, uniqueIndex, extra = {}) => ({ id: projectId * 100 + uniqueIndex, projectId, task: { uniqueIndex }, type: "Comment", ...extra });
const structured = {
  tabs: [{ project: "All" }, { project: "Decisions" }, { project: "Beta" }],
  data: [[note(1, 1), note(1, 2)], [note(1, 2, { decisionCommentId: 9 })], [note(2, 5), note(2, 6)]],
};

test("picker prefers the requested split, then split 0, then the first split holding the task", () => {
  assert.equal(pickInboxPlaylistSplit(structured, { projectId: 2, uniqueIndex: 6 }, "Beta").splitName, "Beta");
  assert.equal(pickInboxPlaylistSplit(structured, { projectId: 1, uniqueIndex: 2 }, "Beta").splitName, "All");
  assert.equal(pickInboxPlaylistSplit(structured, { projectId: 1, uniqueIndex: 2 }, "Decisions").splitName, "Decisions");
  assert.equal(pickInboxPlaylistSplit(structured, { projectId: 1, uniqueIndex: 2 }, null).notifications, structured.data[0]);
  assert.equal(pickInboxPlaylistSplit(structured, { projectId: 2, uniqueIndex: 5 }, null).splitName, "Beta");
  assert.equal(pickInboxPlaylistSplit(structured, { projectId: 9, uniqueIndex: 9 }, "Beta"), null);
  assert.equal(pickInboxPlaylistSplit(undefined, { projectId: 1, uniqueIndex: 1 }, null), null);
});

test("a cold click in split 2 plays split 2's list, a missing split param plays split 0's", () => {
  const shared = { projectId: 1, uniqueIndex: 2 };
  const withSplit = { ...structured, data: [structured.data[0], structured.data[1], [note(3, 1), note(1, 2)]] };
  const inSplit = pickInboxPlaylistSplit(withSplit, shared, "Beta");
  assert.deepEqual(buildInboxTasksPlaylist(inSplit.notifications, false).map((i) => i.projectId), [3, 1]);
  const fallback = pickInboxPlaylistSplit(withSplit, shared, undefined);
  assert.deepEqual(buildInboxTasksPlaylist(fallback.notifications, false).map((i) => i.uniqueIndex), [1, 2]);
  assert.equal(pickInboxPlaylistSplit(withSplit, shared, "Gone").splitName, "All");
});

test("builder dedupes, skips Invited and only adds decision comment ids when asked", () => {
  const list = [note(1, 1), note(1, 1, { decisionCommentId: 4 }), { ...note(5, 5), type: "Invited" }, note(1, 2, { decisionCommentId: 7 })];
  const plain = buildInboxTasksPlaylist(list, false);
  assert.deepEqual(plain.map((i) => `${i.projectId}-${i.uniqueIndex}`), ["1-1", "1-2"]);
  assert.equal("decisionCommentId" in plain[1], false);
  const decisions = buildInboxTasksPlaylist(list, true);
  assert.equal(decisions[1].decisionCommentId, 7);
  assert.equal("decisionCommentId" in decisions[0], false);
});

test("still allowed: a stored playlist holding the current task is kept; empty or foreign ones are restored", () => {
  const current = { projectId: 1, uniqueIndex: 2 };
  assert.equal(inboxPlaylistHoldsTask(buildInboxTasksPlaylist(structured.data[0], false), current), true);
  assert.equal(inboxPlaylistHoldsTask(null, current), false);
  assert.equal(inboxPlaylistHoldsTask([], current), false);
  assert.equal(inboxPlaylistHoldsTask(buildInboxTasksPlaylist(structured.data[2], false), current), false);
});

test("sources wire the split param into the row href and mount the restorer only for inboxFlow", () => {
  const inbox = fs.readFileSync(path.join(root, "src/components/notifications/inboxSplit/index.tsx"), "utf8");
  assert.match(inbox, /&split=\$\{encodeURIComponent\(selectedSplit\)\}/);
  const panels = fs.readFileSync(path.join(root, "src/app/detail/[...slug]/TaskDetailPanels.tsx"), "utf8");
  assert.match(panels, /restoreInboxPlaylist &&/);
  assert.match(panels, /inboxFlow\) === "true"/);
});

test("visible-order playlist visits all three blocked tickets before both normal tickets", () => {
  const at = (hour) => `2026-10-24T${String(hour).padStart(2, "0")}:00:00.000Z`;
  const blocked = (index, hour) => note(15, index, {
    id: String(-index), waitingOnSynthetic: true, createdAt: at(hour),
    task: { uniqueIndex: index, waitingOnUserId: 6 },
  });
  const rows = [blocked(3, 13), blocked(2, 14), blocked(1, 15), note(15, 5, { createdAt: at(11) }), note(15, 4, { createdAt: at(12) })];
  const snapshot = { now: "2026-10-24T16:00:00.000Z", display: { timeZone: "UTC" } };
  const playlist = buildInboxTasksPlaylist(rows, false, { oldestFirst: false, snapshot });
  const { nextRemainingInboxTask } = load("src/lib/taskDetailArchiveNavigation.ts");
  const visited = [];
  for (let current = playlist[0]; current; current = nextRemainingInboxTask(playlist, current)) {
    visited.push(current.uniqueIndex);
  }
  assert.deepEqual(visited, [1, 2, 3, 4, 5]);
  assert.deepEqual(rows.map((row) => row.task.uniqueIndex), [3, 2, 1, 5, 4]);
  assert.deepEqual(buildInboxTasksPlaylist(rows, false).map((item) => item.uniqueIndex), [3, 2, 1, 5, 4]);
});

test("restored Blocked by you playlist keeps the list's oldest-first order across date groups", () => {
  const rows = [
    note(15, 3, { createdAt: "2026-10-24T15:00:00.000Z", waitingOnSynthetic: true }),
    note(15, 1, { createdAt: "2026-10-23T12:00:00.000Z", waitingOnSynthetic: true }),
    note(15, 2, { createdAt: "2026-10-24T13:00:00.000Z", waitingOnSynthetic: true }),
  ];
  const picked = pickInboxPlaylistSplit({ tabs: [{ project: "Blocked by you" }], data: [rows] }, { projectId: 15, uniqueIndex: 1 }, "Blocked by you");
  const playlist = buildInboxTasksPlaylist(picked.notifications, false, {
    oldestFirst: picked.splitName === "Blocked by you",
    snapshot: { now: "2026-10-24T16:00:00.000Z", display: { timeZone: "UTC" } },
  });
  assert.deepEqual(playlist.map((item) => item.uniqueIndex), [1, 2, 3]);
});

test("visible-order deduplication retains the displayed decision comment and handles equal dates stably", () => {
  const createdAt = "2026-10-24T12:00:00.000Z";
  const rows = [
    note(15, 1, { createdAt, decisionCommentId: 8 }),
    note(15, 2, { createdAt, decisionCommentId: 9 }),
    note(15, 1, { createdAt: "2026-10-24T13:00:00.000Z", decisionCommentId: 10 }),
    note(15, 4, { createdAt, type: "Invited" }),
  ];
  const options = { oldestFirst: false, snapshot: { now: "2026-10-24T16:00:00.000Z", display: { timeZone: "UTC" } } };
  assert.deepEqual(buildInboxTasksPlaylist(rows, true, options).map(({ uniqueIndex, decisionCommentId }) => [uniqueIndex, decisionCommentId]), [[1, 10], [2, 9]]);
  assert.deepEqual(buildInboxTasksPlaylist(rows, false, options).map((item) => item.decisionCommentId), [undefined, undefined]);
});
