const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { canWarmPreviousBoardFromInbox } = jiti(
  path.join(root, "src/lib/inboxSync/warmPreviousBoard.ts"),
);

test("previous-Board warm-up waits while Inbox contains only a placeholder", () => {
  assert.equal(canWarmPreviousBoardFromInbox(undefined), false);
  assert.equal(
    canWarmPreviousBoardFromInbox({ dataOrigin: "placeholder" }),
    false,
  );
});

test("either authorized Inbox source unlocks the previous-Board warm-up", () => {
  for (const dataOrigin of ["indexeddb", "network", "optimistic"]) {
    assert.equal(canWarmPreviousBoardFromInbox({ dataOrigin }), true);
  }
});
