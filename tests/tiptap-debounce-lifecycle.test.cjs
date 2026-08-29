const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const helperSource = fs.readFileSync(
  path.join(root, "src/utils/helperFunctions/helperFunctions.ts"),
  "utf8"
);
const functionSource = helperSource.match(
  /export function debounceWithCancel[\s\S]*?(?=\n\nexport interface ISplit)/
)?.[0];

assert.ok(functionSource, "debounceWithCancel implementation not found");

const compiled = ts.transpileModule(functionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function("exports", "module", compiled)(moduleUnderTest.exports, moduleUnderTest);
const { debounceWithCancel } = moduleUnderTest.exports;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("cancel drops pending work", async () => {
  const calls = [];
  const [debounced, cancel] = debounceWithCancel((value) => calls.push(value), 10);

  debounced("draft");
  cancel();
  await wait(20);

  assert.deepEqual(calls, []);
});

test("flush immediately delivers only the latest captured value", async () => {
  const calls = [];
  const [debounced, , flush] = debounceWithCancel((value) => calls.push(value), 20);

  debounced("old draft");
  debounced("latest draft");
  flush();
  assert.deepEqual(calls, ["latest draft"]);

  await wait(30);
  assert.deepEqual(calls, ["latest draft"]);
});

test("task draft autosave captures HTML while the editor is alive and flushes on unmount", () => {
  const hookSource = fs.readFileSync(
    path.join(root, "src/hooks/General/useDebounceWithCancel.jsx"),
    "utf8"
  );
  const editorSource = fs.readFileSync(
    path.join(root, "src/components/RTE/TipTapTaskDetail.tsx"),
    "utf8"
  );

  assert.match(hookSource, /if \(!flushOnUnmount\) return;/);
  assert.doesNotMatch(hookSource, /else cancel\(\)/);
  assert.match(editorSource, /content: editor\.getHTML\(\)/);
  assert.match(editorSource, /projectId: inViewObject\.taskProjectId/);
  assert.match(editorSource, /taskId: inViewObject\.taskId/);
  assert.match(editorSource, /\}, 750, true\);/);
});
