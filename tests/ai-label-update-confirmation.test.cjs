// HTPR-5536: AI Chat asked the user to confirm a plain tag change, and the
// confirmation round-trip then failed to apply it. Retagging must never gate.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/ai-bulk-tools-entry.cjs"), {
  interopDefault: true,
});
const { updateTasksNeedConfirmation } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts")
);

test("adding a tag to one task never asks for confirmation", () => {
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 1,
      update: { add_labels: ["Quick wins"] },
    }),
    false
  );
});

test("retagging many tasks at once still never asks for confirmation", () => {
  const updates = [
    { add_labels: ["Quick wins"] },
    { remove_labels: ["Quick wins"] },
    { labels: ["Quick wins"] },
    { add_labels: ["B"], remove_labels: ["A"] },
  ];
  for (const update of updates) {
    assert.equal(
      updateTasksNeedConfirmation({ targetCount: 50, update }),
      false,
      `expected no confirmation for ${Object.keys(update).join("+")}`
    );
  }
});

test("a tag change bundled with a non-label edit keeps the wide-write gate", () => {
  const update = { add_labels: ["Quick wins"], title: "Renamed" };
  assert.equal(updateTasksNeedConfirmation({ targetCount: 4, update }), true);
  assert.equal(updateTasksNeedConfirmation({ targetCount: 3, update }), false);
});

test("destructive statuses still confirm regardless of labels", () => {
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 1,
      update: { status: "Deleted", add_labels: ["Quick wins"] },
    }),
    true
  );
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 2,
      update: { status: "Archive" },
    }),
    true
  );
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 1,
      update: { status: "Archive" },
    }),
    false
  );
});

test("wide non-label writes keep the four-task confirmation gate", () => {
  assert.equal(
    updateTasksNeedConfirmation({ targetCount: 4, update: { title: "x" } }),
    true
  );
  assert.equal(
    updateTasksNeedConfirmation({ targetCount: 3, update: { title: "x" } }),
    false
  );
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 4,
      update: { section: "Done" },
    }),
    true
  );
});

test("identifier-only and confirmed keys are not mistaken for label edits", () => {
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 4,
      update: { task_ids: [1, 2, 3, 4], confirmed: false },
    }),
    true
  );
});

test("a null due date still counts as a non-label change", () => {
  assert.equal(
    updateTasksNeedConfirmation({
      targetCount: 4,
      update: { due_date: null, add_labels: ["Quick wins"] },
    }),
    true
  );
});

test("the chat route decides the update gate through the shared helper", () => {
  const routeSource = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8"
  );

  assert.match(routeSource, /updateTasksNeedConfirmation\(\{/);
  assert.doesNotMatch(
    routeSource,
    /const needsConfirmation =\s*\n?\s*targets\.length >= 4/
  );
});
