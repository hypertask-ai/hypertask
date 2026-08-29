const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  bindPageReturnEntry,
  createPageReturnHref,
  hasPageReturnRuntimeProof,
  PAGE_RETURN_CONTEXT_PARAM,
  PAGE_RETURN_CONTEXT_TTL_MS,
  returnFromPage,
} = jiti(path.join(root, "src/lib/navigation/pageReturn.ts"));

const origin = "https://app.hypertask.ai";
const taskHref = "/detail/project-15/5199";
const pageHref = "/page/page-public-id";
const nonce = "valid-page-return-nonce-5199";
const now = 1_786_215_000_000;

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
};

const makeRuntime = () => ({});
const storageRuntimes = new WeakMap();
const runtimeForStorage = (storage) => {
  if (!storageRuntimes.has(storage)) {
    storageRuntimes.set(storage, makeRuntime());
  }
  return storageRuntimes.get(storage);
};

const cloneStorage = (storage) => {
  const clone = makeStorage();
  for (const [key, value] of storage.values) clone.setItem(key, value);
  return clone;
};

const makeRouter = () => {
  const calls = [];
  return {
    calls,
    back: () => calls.push(["back"]),
    replace: (href) => calls.push(["replace", href]),
  };
};

const makeHistory = (initialState = { __NA: true }) => {
  let state = initialState;
  const calls = [];
  return {
    calls,
    get state() {
      return state;
    },
    replaceState: (nextState, unused, url) => {
      calls.push(["replaceState", nextState, unused, url]);
      state = nextState;
    },
  };
};

const navigation = (urls, index = urls.length - 1) => ({
  entries: () => urls.map((url) => ({ url })),
  currentEntry: { index },
});

const recordInternalNavigation = (storage, overrides = {}) =>
  createPageReturnHref({
    pageHref,
    taskHref,
    sourceHref: `${origin}${taskHref}?inboxFlow=true#comment-177928`,
    currentOrigin: origin,
    storage,
    runtime: runtimeForStorage(storage),
    nonce,
    now,
    ...overrides,
  });

const bindInternalEntry = (storage, currentHref, history, overrides = {}) =>
  bindPageReturnEntry({
    currentHref,
    taskHref,
    storage,
    history,
    runtime: runtimeForStorage(storage),
    now: now + 500,
    ...overrides,
  });

const returnWithoutNavigationApi = (
  storage,
  currentHref,
  historyState,
  overrides = {},
) => {
  const router = makeRouter();
  const action = returnFromPage({
    router,
    historyState,
    currentHref,
    taskHref,
    storage,
    now: now + 1_000,
    ...overrides,
  });
  return { action, calls: router.calls };
};

test("internal task navigation records exact context and marks the Page URL", () => {
  const storage = makeStorage();
  const runtime = runtimeForStorage(storage);
  const markedHref = recordInternalNavigation(storage);
  const markedUrl = new URL(markedHref, origin);

  assert.equal(markedUrl.pathname, pageHref);
  assert.equal(markedUrl.searchParams.get(PAGE_RETURN_CONTEXT_PARAM), nonce);
  assert.equal(storage.values.size, 1);
  const context = JSON.parse([...storage.values.values()][0]);
  assert.equal(
    context.taskUrl,
    `${origin}${taskHref}?inboxFlow=true#comment-177928`,
  );
  assert.equal(context.pagePathname, pageHref);
  assert.equal(hasPageReturnRuntimeProof(runtime, nonce), true);
});

test("a cloned pending context cannot bind in a new tab before the original Page mounts", () => {
  const originalStorage = makeStorage();
  const originalRuntime = runtimeForStorage(originalStorage);
  const markedHref = recordInternalNavigation(originalStorage);
  const clonedStorage = cloneStorage(originalStorage);
  const clonedRuntime = runtimeForStorage(clonedStorage);
  const clonedHistory = makeHistory();

  assert.equal(hasPageReturnRuntimeProof(originalRuntime, nonce), true);
  assert.equal(hasPageReturnRuntimeProof(clonedRuntime, nonce), false);
  assert.equal(
    bindInternalEntry(
      clonedStorage,
      `${origin}${markedHref}`,
      clonedHistory,
    ),
    false,
  );
  assert.deepEqual(clonedHistory.calls, []);

  const clonedReturn = returnWithoutNavigationApi(
    clonedStorage,
    `${origin}${markedHref}`,
    clonedHistory.state,
  );
  assert.deepEqual(clonedReturn.calls, [
    ["replace", `${taskHref}?inboxFlow=true#comment-177928`],
  ]);
  assert.equal(clonedStorage.values.size, 0, "the rejected clone is cleaned up");

  const originalHistory = makeHistory();
  assert.equal(
    bindInternalEntry(
      originalStorage,
      `${origin}${markedHref}`,
      originalHistory,
    ),
    true,
  );
  assert.equal(
    hasPageReturnRuntimeProof(originalRuntime, nonce),
    false,
    "the original bind consumes its Window-only proof",
  );
});

test("no-Navigation-API browsers go Back only with valid internal context", () => {
  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage);
  const history = makeHistory({ __NA: true, nextInternal: "preserved" });
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, history),
    true,
  );
  assert.equal(history.state.nextInternal, "preserved");
  const result = returnWithoutNavigationApi(
    storage,
    `${origin}${markedHref}`,
    history.state,
  );

  assert.equal(result.action, "back");
  assert.deepEqual(result.calls, [["back"]]);
  assert.equal(storage.values.size, 0, "the one-shot marker is consumed");
});

test("Navigation API browsers require the bound entry and exact task URL", () => {
  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage);
  const history = makeHistory({ __NA: true, nextInternal: "preserved" });
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, history),
    true,
  );
  const router = makeRouter();

  const action = returnFromPage({
    router,
    navigation: navigation([
      `${origin}${taskHref}?inboxFlow=true#comment-177928`,
      `${origin}${markedHref}`,
    ]),
    historyState: history.state,
    currentHref: `${origin}${markedHref}`,
    taskHref,
    storage,
    now: now + 1_000,
  });

  assert.equal(action, "back");
  assert.deepEqual(router.calls, [["back"]]);
  assert.equal(storage.values.size, 0, "the one-shot marker is consumed");
});

test("the marker survives a Page reload in the same tab", () => {
  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage);
  const history = makeHistory();
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, history),
    true,
  );

  // A reload creates a new Window runtime but keeps this tab's URL,
  // sessionStorage, and entry-scoped history.state marker.
  const reloadedRuntime = makeRuntime();
  assert.equal(hasPageReturnRuntimeProof(reloadedRuntime, nonce), false);
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, history, {
      runtime: reloadedRuntime,
    }),
    true,
  );
  const result = returnWithoutNavigationApi(
    storage,
    `${origin}${markedHref}`,
    history.state,
  );
  assert.deepEqual(result.calls, [["back"]]);
});

test("no-Navigation-API direct and unrelated visits never trust unrelated entry state", () => {
  const direct = returnWithoutNavigationApi(
    makeStorage(),
    `${origin}${pageHref}`,
    { __NA: true },
  );
  assert.deepEqual(direct.calls, [["replace", taskHref]]);

  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage, {
    sourceHref: `${origin}/search`,
  });
  assert.equal(markedHref, pageHref, "unrelated sources are not marked");
  const unrelated = returnWithoutNavigationApi(
    storage,
    `${origin}${pageHref}`,
    { __NA: true },
  );
  assert.deepEqual(unrelated.calls, [["replace", taskHref]]);
});

test("cross-origin, stale, wrong-Page, and copied/new-tab contexts are rejected", () => {
  for (const scenario of ["cross-origin", "stale", "wrong-page", "new-tab"]) {
    const storage = makeStorage();
    const markedHref = recordInternalNavigation(storage, {
      ...(scenario === "cross-origin"
        ? { sourceHref: `https://example.test${taskHref}` }
        : {}),
      ...(scenario === "wrong-page" ? { pageHref: "/page/another-page" } : {}),
    });
    const currentHref = `${origin}${
      scenario === "cross-origin" ? pageHref : markedHref
    }`;
    const originalHistory = makeHistory();
    if (scenario === "new-tab") {
      assert.equal(bindInternalEntry(storage, currentHref, originalHistory), true);
    }
    const result = returnWithoutNavigationApi(
      storage,
      currentHref,
      // sessionStorage may be copied by an opener, but history.state is scoped
      // to the newly-created entry and cannot authorize it.
      scenario === "new-tab" ? { __NA: true } : null,
      {
        ...(scenario === "stale"
          ? { now: now + PAGE_RETURN_CONTEXT_TTL_MS + 1 }
          : {}),
        ...(scenario === "wrong-page"
          ? { currentHref: `${origin}${pageHref}?${PAGE_RETURN_CONTEXT_PARAM}=${nonce}` }
          : {}),
      },
    );

    assert.deepEqual(
      result.calls,
      [[
        "replace",
        scenario === "new-tab"
          ? `${taskHref}?inboxFlow=true#comment-177928`
          : taskHref,
      ]],
      `${scenario} must not call Back`,
    );
  }
});

test("a valid marked URL replayed in the same tab cannot authorize Back", () => {
  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage);
  const originalHistory = makeHistory();
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, originalHistory),
    true,
  );

  // The same URL is revisited after another navigation. It still has the
  // nonce and sessionStorage context, but this is a different history entry.
  const replay = returnWithoutNavigationApi(
    storage,
    `${origin}${markedHref}`,
    { __NA: true },
  );

  assert.equal(replay.action, "replace");
  assert.deepEqual(replay.calls, [
    ["replace", `${taskHref}?inboxFlow=true#comment-177928`],
  ]);
});

test("Navigation API direct, copied, and replayed entries cannot bypass binding", () => {
  const directRouter = makeRouter();
  returnFromPage({
    router: directRouter,
    navigation: navigation([
      `${origin}${taskHref}`,
      `${origin}${pageHref}`,
    ]),
    historyState: { __NA: true },
    currentHref: `${origin}${pageHref}`,
    taskHref,
    storage: makeStorage(),
    now: now + 1_000,
  });
  assert.deepEqual(directRouter.calls, [["replace", taskHref]]);

  for (const scenario of ["copied", "replayed"]) {
    const storage = makeStorage();
    const markedHref = recordInternalNavigation(storage);
    const originalHistory = makeHistory();
    assert.equal(
      bindInternalEntry(storage, `${origin}${markedHref}`, originalHistory),
      true,
    );
    const router = makeRouter();

    returnFromPage({
      router,
      navigation: navigation([
        `${origin}${taskHref}?inboxFlow=true#comment-177928`,
        `${origin}${markedHref}`,
      ]),
      // A copied/new-tab or replayed entry does not own the original entry's
      // classic history-state marker, even if sessionStorage was copied or the
      // marked URL remains available in this tab.
      historyState: { __NA: true },
      currentHref: `${origin}${markedHref}`,
      taskHref,
      storage,
      now: now + 1_000,
    });

    assert.deepEqual(
      router.calls,
      [["replace", `${taskHref}?inboxFlow=true#comment-177928`]],
      `${scenario} must not call Back`,
    );
  }
});

test("Navigation API requires the previous task query and hash to match exactly", () => {
  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage);
  const history = makeHistory();
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, history),
    true,
  );
  const router = makeRouter();

  returnFromPage({
    router,
    navigation: navigation([
      `${origin}${taskHref}?inboxFlow=false#comment-different`,
      `${origin}${markedHref}`,
    ]),
    historyState: history.state,
    currentHref: `${origin}${markedHref}`,
    taskHref,
    storage,
    now: now + 1_000,
  });

  assert.deepEqual(router.calls, [
    ["replace", `${taskHref}?inboxFlow=true#comment-177928`],
  ]);
});

test("inspectable history overrides a marker when the immediate entry is unrelated", () => {
  const storage = makeStorage();
  const markedHref = recordInternalNavigation(storage);
  const history = makeHistory();
  assert.equal(
    bindInternalEntry(storage, `${origin}${markedHref}`, history),
    true,
  );
  const router = makeRouter();
  returnFromPage({
    router,
    navigation: navigation([
      `${origin}/search`,
      `${origin}${markedHref}`,
    ]),
    historyState: history.state,
    currentHref: `${origin}${markedHref}`,
    taskHref,
    storage,
    now: now + 1_000,
  });

  assert.deepEqual(router.calls, [
    ["replace", `${taskHref}?inboxFlow=true#comment-177928`],
  ]);
});

test("both internal task-to-Page paths record return context", () => {
  const existingPageSource = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/DescriptionPages.tsx",
    ),
    "utf8",
  );
  const newPageSource = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/TaskPagesContext.tsx",
    ),
    "utf8",
  );

  assert.match(existingPageSource, /createPageReturnHref\(\{/);
  assert.match(newPageSource, /createPageReturnHref\(\{/);
});
