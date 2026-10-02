const assert = require("node:assert/strict");
const fs = require("./refactored-module-source.cjs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const editorSource = fs.readFileSync(
  path.join(root, "src/components/RTE/TipTapTaskDetail.tsx"),
  "utf8",
);
const uploadSource = fs.readFileSync(
  path.join(root, "src/components/Common/AttachmentsUpload/index.tsx"),
  "utf8",
);

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function findNode(source, predicate) {
  const file = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (predicate(node)) found = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, "production attachment implementation not found");
  return found;
}

const receiveAttachments = new Function(
  "setNewCommentAttachments",
  `${compile("const " + findNode(editorSource, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText() === "getAttachments",
  ))}; return getAttachments;`,
);
const emitAttachments = new Function(
  "fileItems",
  "props",
  compile(findNode(uploadSource, (node) =>
    ts.isExpressionStatement(node) && node.getText().startsWith("props.callback(fileItems.map"),
  )),
);
const filesForSave = new Function(
  "newCommentAttachments",
  `${compile("const " + findNode(editorSource, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText() === "currentAttachmentFiles",
  ))}; return currentAttachmentFiles;`,
);

function mountUploader(initialFiles) {
  let state = initialFiles;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compile(fs.readFileSync(
    path.join(root, "src/components/Common/AttachmentsUpload/FileUploadHandler.tsx"),
    "utf8",
  )))(loaded, loaded.exports, (request) => {
    if (request === "react") return {
      useRef: () => ({ current: null }),
      useState: () => [state, (update) => {
        state = typeof update === "function" ? update(state) : update;
      }],
    };
    if (request === "@/utils/helperFunctions/helperFunctions") return {
      processFiles: () => { throw new Error("File processing is not used in this test"); },
    };
    throw new Error(`Unexpected dependency: ${request}`);
  });
  return () => loaded.exports.useFileUpload(state);
}

function roundTrip(initialFiles) {
  let snapshot = initialFiles;
  const callback = receiveAttachments((files) => { snapshot = files; });
  emitAttachments(mountUploader(initialFiles)().fileItems, { callback });
  return { snapshot, callback, getSnapshot: () => snapshot };
}

test("selected files survive an uploader remount and can still be saved", () => {
  const file = new File(["attachment"], "notes.txt", { type: "text/plain" });
  const { snapshot, callback, getSnapshot } = roundTrip([{ id: 0, file }]);
  const remounted = mountUploader(snapshot)();

  assert.deepEqual(remounted.files, [file]);
  emitAttachments(remounted.fileItems, { callback });
  assert.deepEqual(filesForSave(getSnapshot()), [file]);
});

test("existing and AI attachment metadata survive a trigger reset", () => {
  const file = {
    id: 23,
    name: "image.png",
    type: "image/png",
    size: "42",
    source: "https://example.com/image.png",
  };
  const { snapshot, callback, getSnapshot } = roundTrip([{ id: 0, file }]);
  const render = mountUploader([]);
  render().resetFiles(snapshot);
  emitAttachments(render().fileItems, { callback });

  assert.deepEqual(filesForSave(getSnapshot()), [file]);
  assert.equal(filesForSave(getSnapshot())[0], file);
});

test("remounted attachments remain removable and an empty snapshot stays empty", () => {
  const first = new File(["first"], "first.txt");
  const second = new File(["second"], "second.txt");
  const { snapshot, callback, getSnapshot } = roundTrip([
    { id: 0, file: first },
    { id: 1, file: second },
  ]);
  const render = mountUploader(snapshot);
  render().removeFile(first.name);
  emitAttachments(render().fileItems, { callback });
  assert.deepEqual(filesForSave(getSnapshot()), [second]);

  render().clearFiles();
  emitAttachments(render().fileItems, { callback });
  assert.deepEqual(getSnapshot(), []);
  assert.deepEqual(filesForSave(getSnapshot()), []);
});
