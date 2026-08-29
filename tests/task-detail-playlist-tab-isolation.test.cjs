// HTPR-5584: a task-detail playlist must stay inside the browser tab that wrote it,
// so archiving in one tab cannot navigate into another tab's stale playlist.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");

// A stand-in for one browser tab's sessionStorage. Two instances share no state,
// which is exactly the isolation sessionStorage gives real tabs.
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

// Runs `body` with `window` bound to one tab's storage, giving it a freshly loaded
// copy of the real tasksPlayListAtom. Loading the module again models a page load in
// that tab: the atom is re-created and must read its value back from that tab's storage.
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
      // Subscribing mounts the atom, which makes Jotai re-read storage. This is what
      // task detail does when it renders, so the mount-time value is what it sees.
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

  // The second tab must start empty. Before this fix both tabs shared localStorage,
  // so archiving in the inbox tab could open a task from this unrelated playlist.
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

test("a reload in the same tab restores the playlist on the first read", () => {
  const tabA = createTabStorage();

  withTab({ sessionStorage: tabA }, (tab) => tab.write(PLAYLIST_A));

  // Reloading the same tab re-creates the atom. The very first read must already see
  // the stored playlist: task-detail navigation reads it during the initial render,
  // and an empty first read would break next/back after a reload.
  withTab({ sessionStorage: tabA }, (afterReload) => {
    assert.deepEqual(afterReload.read(), PLAYLIST_A);
  });
});

test("the playlist still works when session storage is unavailable", () => {
  const blockedWindow = {
    get sessionStorage() {
      throw new Error("storage access denied");
    },
  };

  // Blocked storage must not throw on module load or first read; navigation then
  // falls back to an in-memory playlist for that tab.
  withTab(blockedWindow, (tab) => {
    assert.equal(tab.read(), null);
    tab.write(PLAYLIST_A);
    assert.deepEqual(tab.read(), PLAYLIST_A);

    // Jotai re-reads storage when the atom mounts, so a fallback that dropped writes
    // would hand navigation an empty playlist right after one was set.
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

  // Some browsers expose sessionStorage but throw only when its methods run.
  // Reads and writes must use the same in-memory fallback in that case.
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
