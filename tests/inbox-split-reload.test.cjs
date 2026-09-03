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

test("a split that is no longer available leaves selection unchanged", () => {
  assert.strictEqual(resolve({ split: "Missing" }), null);
});
