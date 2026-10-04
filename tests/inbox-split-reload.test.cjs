const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const jiti = require("jiti")(path.join(process.cwd(), "tests/inbox-split-reload.test.cjs"), {
  interopDefault: true,
});

const { getInitialInboxSplitIndex } = jiti(
  path.join(process.cwd(), "src/lib/inboxSplitSettings.ts"),
);

const tabs = [
  { project: "Important", projectId: null },
  { project: "Reactions", projectId: null },
  { project: "Product", projectId: 15 },
];

const resolve = (overrides = {}) =>
  getInitialInboxSplitIndex({
    tabs,
    urlSelectionProcessed: false,
    defaultSelectionProcessed: false,
    ...overrides,
  });

test("the inbox restores a system split from the URL after reload", () => {
  assert.strictEqual(resolve({ split: "Reactions" }), 1);
});

test("a board split restores by project id", () => {
  assert.strictEqual(resolve({ split: "Product", projectId: "15" }), 2);
});

test("a later tabs refresh does not reset a restored URL split", () => {
  assert.strictEqual(
    resolve({ split: "Reactions", urlSelectionProcessed: true }),
    null,
  );
});

test("an inbox URL without a split initializes the default only once", () => {
  assert.strictEqual(resolve(), 0);
  assert.strictEqual(resolve({ defaultSelectionProcessed: true }), null);
});

test("inbox startup cannot replace a cold cached ticket URL", () => {
  const source = require("node:fs").readFileSync(path.join(process.cwd(), "src/app/inbox/Inbox.tsx"), "utf8");
  const start = source.indexOf("// Set active split on initial render");
  const end = source.indexOf("const handleBulkArchive", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  for (const [pathname, cachedTaskDetail, expectedWrites] of [
    ["/detail/project-1/1", { accountId: 985, taskId: 1 }, 0],
    ["/detail/project-1/1", undefined, 1],
    ["/inbox", { accountId: 985, taskId: 1 }, 1],
    ["/inbox", undefined, 1],
  ]) {
    const writes = [];
    const bindings = {
      useEffect: effect => effect(),
      window: { location: { pathname }, history: { state: { cachedTaskDetail } } },
      _notificationsTQ: { structuredData: { tabs } },
      getInitialInboxSplitIndex,
      preselectedSplit: undefined,
      preselectedProject: undefined,
      preselectedSplitProcessed: { current: false },
      initialResetToFirstDone: { current: false },
      navigateTabs: index => writes.push(index),
    };
    new Function(...Object.keys(bindings), block)(...Object.values(bindings));
    assert.strictEqual(writes.length, expectedWrites, `${pathname}: cached=${Boolean(cachedTaskDetail)}`);
  }
});

test("a split that is no longer available leaves selection unchanged", () => {
  assert.strictEqual(resolve({ split: "Missing" }), null);
});
