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

test("a captured autosave updates only its source task's draft cache", async () => {
  const editorSource = fs.readFileSync(
    path.join(root, "src/components/RTE/TipTapTaskDetail.tsx"),
    "utf8"
  );
  const updateDraftsSource = editorSource.match(
    /const updateDrafts = async[\s\S]*?(?=\n  const \[debouncedRequest)/
  )?.[0];
  const debouncedCallbackSource = editorSource.match(
    /useDebounceWithCancel\(([\s\S]*?\n  \}), 750, true\)/
  )?.[1];

  assert.ok(updateDraftsSource, "updateDrafts implementation not found");
  assert.ok(debouncedCallbackSource, "debounced draft callback not found");

  const inViewObject = { taskProjectId: 15, taskId: 101 };
  const taskBCacheKey = ["draft for [task,userId]:", 202, 7];
  const cache = new Map([
    [
      JSON.stringify(taskBCacheKey),
      [{ id: 2, type: "Comment", content: "task B draft", taskId: 202 }],
    ],
  ]);
  const queryClient = {
    getQueryData: (key) => cache.get(JSON.stringify(key)),
    setQueryData: (key, value) => cache.set(JSON.stringify(key), value),
  };
  const apiCalls = [];
  const updateDraftHelper = (...args) => {
    apiCalls.push(args);
    return Promise.resolve({ status: 204 });
  };

  const updateModule = { exports: {} };
  const compiledUpdateDrafts = ts.transpileModule(
    `${updateDraftsSource}\nmodule.exports = updateDrafts;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  new Function(
    "module",
    "inViewObject",
    "handleSave",
    "currentUser",
    "mode",
    "uploadingDescription",
    "updateDraftHelper",
    "invalidateUserDrafts",
    "queryClient",
    "draftQueryKey",
    compiledUpdateDrafts
  )(
    updateModule,
    inViewObject,
    true,
    { id: 7 },
    "read-comments",
    false,
    updateDraftHelper,
    () => {},
    queryClient,
    taskBCacheKey
  );

  const callbackModule = { exports: {} };
  const compiledCallback = ts.transpileModule(
    `const callback = ${debouncedCallbackSource};\nmodule.exports = callback;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  new Function("module", "updateDrafts", compiledCallback)(
    callbackModule,
    updateModule.exports
  );

  const [debounced, , flush] = debounceWithCancel(callbackModule.exports, 20);
  debounced({ content: "task A draft", projectId: 15, taskId: 101 });
  inViewObject.taskId = 202;
  flush();
  await wait(0);

  assert.deepEqual(apiCalls, [[15, 101, 7, "Comment", "task A draft"]]);
  assert.equal(
    cache.get(JSON.stringify(["draft for [task,userId]:", 101, 7]))[0].content,
    "task A draft"
  );
  assert.equal(cache.get(JSON.stringify(taskBCacheKey))[0].content, "task B draft");
});
