// HTPR-5521 (duplicate HTPR-5519): a failed attachment upload crashed with
// "m is not a function". SingleFileInputPreview's catch handler calls the
// gallery's remove handler, which called the optional handleRemove prop
// unguarded. The comment and description composers both mount the gallery with
// handleRemove={null}, so the rejection went unhandled and wedged the composer.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { createRemoveHandler } = jiti(
  path.join(root, "src/components/Common/AttachmentsUpload/createRemoveHandler.ts")
);

test("a composer mount with no remove handler survives a removal", () => {
  const removeHandler = createRemoveHandler({
    mode: "others",
    setUploadedFiles: () => {},
    handleRemove: null,
  });
  assert.doesNotThrow(() => removeHandler("screenshot.png"));
});

test("a failed upload does not leave an unhandled rejection on a null handler", async () => {
  const removeHandler = createRemoveHandler({
    mode: "others",
    setUploadedFiles: () => {},
    handleRemove: null,
  });
  // Mirrors SingleFileInputPreview: the upload rejects, the catch handler calls
  // back into the gallery. Before the fix this threw inside the catch and the
  // rejection escaped to window.onunhandledrejection.
  const onUploadFailed = () => removeHandler("screenshot.png");
  await assert.doesNotReject(() =>
    Promise.reject(new Error("upload failed")).catch(onUploadFailed)
  );
});

test("a provided remove handler still receives the file name", () => {
  const removed = [];
  const removeHandler = createRemoveHandler({
    mode: "others",
    setUploadedFiles: () => {},
    handleRemove: (name) => removed.push(name),
  });
  removeHandler("notes.pdf");
  assert.deepEqual(removed, ["notes.pdf"]);
});

test("create-task mode drops the file from the uploaded list", () => {
  let uploaded = [{ file: { name: "a.png" } }, { file: { name: "b.png" } }];
  const removeHandler = createRemoveHandler({
    mode: "Creating task",
    setUploadedFiles: (updater) => {
      uploaded = updater(uploaded);
    },
    handleRemove: null,
  });
  removeHandler("a.png");
  assert.deepEqual(uploaded, [{ file: { name: "b.png" } }]);
});

test("create-task mode still prunes when an entry has no file", () => {
  let uploaded = [null, { file: { name: "a.png" } }];
  const removeHandler = createRemoveHandler({
    mode: "Creating task",
    setUploadedFiles: (updater) => {
      uploaded = updater(uploaded);
    },
    handleRemove: null,
  });
  assert.doesNotThrow(() => removeHandler("a.png"));
  assert.deepEqual(uploaded, [null]);
});
