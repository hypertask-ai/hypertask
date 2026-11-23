const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htpr-9605-not-stale-hint.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { notStaleFilterHint } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/FilterHelperFunctions.ts"),
);

test("the Not stale hint names the board's warn days", () => {
  assert.equal(
    notStaleFilterHint(14),
    "No comment and no column move in 14 days hides a card.",
  );
});

test("the Not stale hint follows a different board threshold", () => {
  assert.equal(
    notStaleFilterHint(3),
    "No comment and no column move in 3 days hides a card.",
  );
});

test("the Not stale hint falls back to the default warn days", () => {
  const expected = "No comment and no column move in 7 days hides a card.";
  assert.equal(notStaleFilterHint(), expected);
  assert.equal(notStaleFilterHint(null), expected);
});

test("the Not stale hint reads a single warn day", () => {
  assert.equal(
    notStaleFilterHint(1),
    "No comment and no column move in 1 day hides a card.",
  );
});
