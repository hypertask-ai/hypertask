const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const { toastIdsToDismiss } = jiti(path.join(root, "src/lib/toastIdsToDismiss.ts"));

test("an undo toast closes every other visible toast so they never overlap", () => {
  const newestFirst = [{ id: "comment-sent", visible: true }, { id: "older", visible: true }, { id: "leaving", visible: false }];
  assert.deepEqual(toastIdsToDismiss(newestFirst, true), ["comment-sent", "older"]);
});

test("without an undo toast only the newest toast stays", () => {
  assert.deepEqual(toastIdsToDismiss([{ id: "new", visible: true }, { id: "old", visible: true }], false), ["old"]);
});

test("still allowed: a single toast, or none, is left alone", () => {
  assert.deepEqual(toastIdsToDismiss([{ id: "only", visible: true }], false), []);
  assert.deepEqual(toastIdsToDismiss([{ id: "leaving", visible: false }], false), []);
  assert.deepEqual(toastIdsToDismiss([], true), []);
});

test("the guard runs next to the undo toaster behind the bugfix flag, default Everyone", () => {
  const definition = fs.readFileSync(path.join(root, "src/lib/flags/definitions/htpr-7657-one-toast.ts"), "utf8");
  assert.match(definition, /kind: "bugfix"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
  const toaster = fs.readFileSync(path.join(root, "src/components/undoToast/index.tsx"), "utf8");
  assert.match(toaster, /useFlag\(HTPR_7657_ONE_TOAST_FLAG\)/);
  assert.match(toaster, /useToasterStore\(undefined, SINGLE_UNDO_TOASTER_ID\)/);
  assert.match(toaster, /oneToastAtATime && <KeepOneToastVisible \/>/);
});
