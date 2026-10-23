const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relativePath) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(require, exports);
  return exports;
}

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
