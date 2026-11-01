const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const { toastIdsToDismiss } = jiti(path.join(root, "src/lib/toastIdsToDismiss.ts"));
const undo = { id: "undo", visible: true };

test("an undo toast closes every other visible toast so they never overlap", () => {
  const newestFirst = [{ id: "comment-sent", visible: true }, { id: "older", visible: true }, { id: "leaving", visible: false }];
  assert.deepEqual(toastIdsToDismiss(newestFirst, [undo]), { toasts: ["comment-sent", "older"], undoToasts: [] });
});

test("without an undo toast only the newest toast stays", () => {
  assert.deepEqual(toastIdsToDismiss([{ id: "new", visible: true }, { id: "old", visible: true }], []), { toasts: ["old"], undoToasts: [] });
});

test("a failure message arriving after the undo toast replaces it and any other toast", () => {
  const newestFirst = [{ id: "sent", visible: true, createdAt: 30 }, { id: "failed", visible: true, type: "error", createdAt: 20 }, { id: "older", visible: true, createdAt: 5 }];
  assert.deepEqual(toastIdsToDismiss(newestFirst, [{ ...undo, createdAt: 10 }]), { toasts: ["sent", "older"], undoToasts: ["undo"] });
});

test("a new undo toast replaces an older failure message, so its Undo button stays", () => {
  const newestFirst = [{ id: "failed", visible: true, type: "error", createdAt: 10 }];
  assert.deepEqual(toastIdsToDismiss(newestFirst, [{ ...undo, createdAt: 20 }]), { toasts: ["failed"], undoToasts: [] });
});

test("still allowed: a single toast, a lone undo toast, or nothing is left alone", () => {
  assert.deepEqual(toastIdsToDismiss([{ id: "only", visible: true }], []), { toasts: [], undoToasts: [] });
  assert.deepEqual(toastIdsToDismiss([{ id: "leaving", visible: false }], [undo]), { toasts: [], undoToasts: [] });
  assert.deepEqual(toastIdsToDismiss([{ id: "failed", visible: true, type: "error" }], []), { toasts: [], undoToasts: [] });
  assert.deepEqual(toastIdsToDismiss([], [{ id: "undo-leaving", visible: false }]), { toasts: [], undoToasts: [] });
});
