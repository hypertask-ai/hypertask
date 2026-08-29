const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { jumpToInboxBoundary, shouldPreserveNativeInboxTab } = jiti(
  path.join(root, "src/lib/inboxKeyboardNavigation.ts"),
);

test("draft rows do not disable desktop split cycling unless a draft control has focus", () => {
  assert.equal(shouldPreserveNativeInboxTab(null), false);
  assert.equal(shouldPreserveNativeInboxTab({ closest: () => null }), false);
});

test("Tab stays native while focus is inside a draft control", () => {
  assert.equal(
    shouldPreserveNativeInboxTab({
      closest: (selector) =>
        selector === '[data-inbox-draft-control="true"]' ? {} : null,
    }),
    true,
  );
});

test("Shift+G G focuses and scrolls the last inbox row", () => {
  const calls = [];
  const targetIndex = jumpToInboxBoundary(
    [{ id: "first" }, { id: "middle" }, { id: "last" }],
    true,
    (id) => ({
      scrollIntoView: (options) => calls.push({ id, options }),
    }),
  );

  assert.equal(targetIndex, 2);
  assert.deepEqual(calls, [
    {
      id: "inbox-last",
      options: { behavior: "smooth", block: "center" },
    },
  ]);
});

test("G G focuses and scrolls the first inbox row", () => {
  const calls = [];
  const targetIndex = jumpToInboxBoundary(
    [{ id: 10 }, { id: 20 }],
    false,
    (id) => ({
      scrollIntoView: (options) => calls.push({ id, options }),
    }),
  );

  assert.equal(targetIndex, 0);
  assert.deepEqual(calls[0], {
    id: "inbox-10",
    options: { behavior: "smooth", block: "center" },
  });
});

test("an empty inbox has no boundary target", () => {
  let lookedUp = false;
  const targetIndex = jumpToInboxBoundary([], true, () => {
    lookedUp = true;
    return null;
  });

  assert.equal(targetIndex, null);
  assert.equal(lookedUp, false);
});

test("the caller can restrict scrolling to the active split", () => {
  const hiddenCalls = [];
  const activeCalls = [];
  const duplicateRows = {
    hidden: {
      id: "inbox-last",
      scrollIntoView: (options) => hiddenCalls.push(options),
    },
    active: {
      id: "inbox-last",
      scrollIntoView: (options) => activeCalls.push(options),
    },
  };
  const activeSplitRows = [duplicateRows.active];

  const targetIndex = jumpToInboxBoundary(
    [{ id: "first" }, { id: "last" }],
    true,
    (id) => activeSplitRows.find((row) => row.id === id) ?? null,
  );

  assert.equal(targetIndex, 1);
  assert.equal(hiddenCalls.length, 0);
  assert.deepEqual(activeCalls, [{ behavior: "smooth", block: "center" }]);
});
