const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");

function createTabStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
    get raw() {
      return Object.fromEntries(data);
    },
  };
}

function withTab(windowValue, body) {
  const previousWindow = global.window;
  global.window = windowValue;

  try {
    const jiti = createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      alias: {
        "@/lib/state": path.join(root, "tests/stubs/state-noop.cjs"),
        "@": path.join(root, "src"),
      },
    });
    const { createStore } = require("jotai");
    const { RESET } = require("jotai/utils");
    const { tasksPlayListAtom } = jiti(path.join(root, "src/store/index.ts"));
    const store = createStore();

    return body({
      read: () => store.get(tasksPlayListAtom),
      write: (value) => store.set(tasksPlayListAtom, value),
      reset: () => store.set(tasksPlayListAtom, RESET),
      readAfterMount: () => {
        const unsubscribe = store.sub(tasksPlayListAtom, () => {});
        try {
          return store.get(tasksPlayListAtom);
        } finally {
          unsubscribe();
        }
      },
    });
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
  }
}

const PLAYLIST_A = [{ id: 1, taskId: "A1" }, { id: 2, taskId: "A2" }];

test("a playlist written in one tab is invisible to another tab", () => {
  const tabA = createTabStorage();
  const tabB = createTabStorage();

  withTab({ sessionStorage: tabA }, (inboxTab) => {
    inboxTab.write(PLAYLIST_A);
    assert.deepEqual(inboxTab.read(), PLAYLIST_A);
  });

  withTab({ sessionStorage: tabB }, (otherTab) => {
    assert.equal(otherTab.read(), null);
  });
});

test("one tab's playlist writes never leak into another tab's storage", () => {
  const tabA = createTabStorage();
  const tabB = createTabStorage();

  withTab({ sessionStorage: tabA }, (tab) => tab.write(PLAYLIST_A));
  withTab({ sessionStorage: tabB }, (tab) => tab.write([{ id: 9, taskId: "B1" }]));

  assert.match(JSON.stringify(tabA.raw), /A1/);
  assert.doesNotMatch(JSON.stringify(tabA.raw), /B1/);
  assert.doesNotMatch(JSON.stringify(tabB.raw), /A1/);
});

test("a reload in the same tab restores the playlist once task detail mounts it", () => {
  const tabA = createTabStorage();

  withTab({ sessionStorage: tabA }, (tab) => tab.write(PLAYLIST_A));

  withTab({ sessionStorage: tabA }, (afterReload) => {
    assert.equal(afterReload.read(), null);
    assert.deepEqual(afterReload.readAfterMount(), PLAYLIST_A);
  });
});

test("the playlist still works when session storage is unavailable", () => {
  const blockedWindow = {
    get sessionStorage() {
      throw new Error("storage access denied");
    },
  };

  withTab(blockedWindow, (tab) => {
    assert.equal(tab.read(), null);
    tab.write(PLAYLIST_A);
    assert.deepEqual(tab.read(), PLAYLIST_A);

    assert.deepEqual(tab.readAfterMount(), PLAYLIST_A);
  });
});

test("the playlist falls back when session storage methods throw", () => {
  const blockedStorage = {
    getItem: () => {
      throw new Error("storage reads denied");
    },
    setItem: () => {
      throw new Error("storage writes denied");
    },
    removeItem: () => {
      throw new Error("storage deletes denied");
    },
  };

  withTab({ sessionStorage: blockedStorage }, (tab) => {
    assert.equal(tab.read(), null);
    tab.write(PLAYLIST_A);
    assert.deepEqual(tab.readAfterMount(), PLAYLIST_A);
    assert.doesNotThrow(() => tab.reset());
  });
});

test("a failed storage delete cannot restore a stale playlist", () => {
  const staleStorage = createTabStorage();
  staleStorage.removeItem = () => {
    throw new Error("storage deletes denied");
  };

  withTab({ sessionStorage: staleStorage }, (tab) => {
    tab.write(PLAYLIST_A);
    tab.reset();
    assert.equal(tab.readAfterMount(), null);
  });
});
