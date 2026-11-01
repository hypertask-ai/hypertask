const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

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
