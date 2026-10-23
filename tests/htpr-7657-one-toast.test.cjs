const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("the guard runs next to the undo toaster behind the bugfix flag, default Everyone", () => {
  const definition = fs.readFileSync(path.join(root, "src/lib/flags/definitions/htpr-7657-one-toast.ts"), "utf8");
  assert.match(definition, /kind: "bugfix"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
  const toaster = fs.readFileSync(path.join(root, "src/components/undoToast/index.tsx"), "utf8");
  assert.match(toaster, /useFlag\(HTPR_7657_ONE_TOAST_FLAG\)/);
  assert.match(toaster, /useToasterStore\(undefined, SINGLE_UNDO_TOASTER_ID\)/);
  assert.match(toaster, /toast\.dismiss\(id, SINGLE_UNDO_TOASTER_ID\)/);
  assert.match(toaster, /oneToastAtATime && <KeepOneToastVisible \/>/);
});
