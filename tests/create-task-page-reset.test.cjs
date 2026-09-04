const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/components/RTE/TiptapCreateTaskModal.tsx"),
  "utf8",
);

test("successful creation clears every in-memory part of the task composer", () => {
  assert.match(
    source,
    /const resetComposerAfterCreate = \(\) => \{[\s\S]*?resetFormValues\(\);[\s\S]*?setFilesDropped\(\[\]\);[\s\S]*?setNewCommentAttachments\(\[\]\);[\s\S]*?setTrigger\(\(current\) => !current\);[\s\S]*?handleSetUserInput\(""\);[\s\S]*?setShouldShowAITaskWriter\(false\);[\s\S]*?editor\?\.chain\(\)\.unsetHighlight\(\)\.clearContent\(\)\.run\(\);[\s\S]*?\};/,
  );
});

test("the standard save resets the creator before navigating away", () => {
  assert.match(
    source,
    /const createTask = CreateTaskAndDescription\(\s*descriptionAtSave,\s*titleAtSave,[\s\S]*?\);[\s\S]*?const taskUrl = await createTask;[\s\S]*?if \(taskUrl\) \{[\s\S]*?resetComposerAfterCreate\(\);[\s\S]*?await asyncPush\(taskUrl\);/,
  );
  assert.match(
    source,
    /if \(isMbl && pathname !== "\/new"\) \{[\s\S]*?await closeBackDismissBeforeNavigation\([\s\S]*?\);[\s\S]*?await asyncPush\(taskUrl\);\s*if \(!isMbl && pathname !== "\/new"\) closeHandler\(\);/,
    "mobile must remove its temporary back entry before opening the task, while desktop closes after navigation",
  );
});

test("all save modes reset only after a task was created", () => {
  assert.equal(
    source.match(/resetComposerAfterCreate\(\);/g)?.length,
    3,
    "Save, Save & close, and Save & new must clear successful creates",
  );
  assert.equal(
    source.match(/if \(taskUrl\)/g)?.length >= 1,
    true,
    "navigation modes must preserve the form when creation returns no task",
  );
  assert.match(
    source,
    /const createTask = CreateTaskAndDescription\(\s*descriptionAtSave,\s*titleAtSave,\s*formValuesAtSave,?\s*\);\s*const traceScope = getTaskCreatePerformanceTraceScope\(\);\s*toast\.promise\(createTask, \{[\s\S]*?success: \(\) => \{[\s\S]*?resetComposerAfterCreate\(\);[\s\S]*?closeHandler\(true\);/,
    "Save & close must not discard or navigate until creation succeeds",
  );
  assert.match(
    source,
    /success: \(\) => \{\s*localStorage\.removeItem\("MENTION_PROJECT_ID"\);/,
    "failed Save & close attempts must preserve the mention context",
  );
});

const createSource = fs.readFileSync(
  path.join(root, "src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts"),
  "utf8",
);

test("missing task results reject before any success handler can reset", () => {
  assert.match(
    createSource,
    /if \(!task\) throw new Error\("Task could not be created"\);/,
  );
});

test("the composer never persists or restores a draft (HTPR-5537)", () => {
  assert.equal(
    /localStorage\.setItem\(\s*(?:draftKey|`create-task-draft)/.test(createSource),
    false,
    "closing the create-task modal must not save the typed entry anywhere",
  );
  assert.equal(
    /localStorage\.getItem\([^)]*draft/i.test(createSource),
    false,
    "the create-task modal must always open blank, never rehydrated from storage",
  );
});

test("the composer purges stored drafts on mount", () => {
  assert.match(
    createSource,
    /useEffect\(\(\) => \{\s*purgeLegacyCreateTaskDrafts\(\);\s*\}, \[\]\);/,
  );
});

test("purging removes every stored draft and leaves other keys alone", () => {
  const { createJiti } = require("jiti");
  const jiti = createJiti(__filename, {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });

  const store = new Map();
  const fakeLocalStorage = {
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const previousLocalStorage = global.localStorage;
  Object.defineProperty(global, "localStorage", {
    value: fakeLocalStorage,
    configurable: true,
  });

  try {
    const { purgeLegacyCreateTaskDrafts } = jiti(
      path.join(root, "src/lib/createTaskDraftCleanup.ts"),
    );

    localStorage.setItem("create-task-draft:6:15", '{"title":"old entry"}');
    localStorage.setItem("create-task-draft:6:22", '{"title":"another"}');
    localStorage.setItem("MENTION_PROJECT_ID", "15");

    purgeLegacyCreateTaskDrafts();

    assert.equal(localStorage.getItem("create-task-draft:6:15"), null);
    assert.equal(localStorage.getItem("create-task-draft:6:22"), null);
    assert.equal(localStorage.getItem("MENTION_PROJECT_ID"), "15");
  } finally {
    if (previousLocalStorage === undefined) {
      delete global.localStorage;
    } else {
      Object.defineProperty(global, "localStorage", {
        value: previousLocalStorage,
        configurable: true,
      });
    }
  }
});
