const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { normalizeCreateTaskFormDate } = jiti(
  path.join(root, "src/lib/createTaskFormDate.ts"),
);

test("create-task dates normalize serialized values before the form formats them", () => {
  const dueDate = normalizeCreateTaskFormDate("2026-03-08");

  assert.ok(dueDate instanceof Date);
  assert.equal(dueDate.getFullYear(), 2026);
  assert.equal(dueDate.getMonth(), 2);
  assert.equal(dueDate.getDate(), 8);
  assert.equal(
    dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    "Mar 8",
  );
});

test("create-task date normalization preserves valid Dates and rejects malformed values", () => {
  const existing = new Date(2026, 2, 8, 9, 30);

  assert.equal(normalizeCreateTaskFormDate(existing), existing);
  assert.equal(
    normalizeCreateTaskFormDate("2026-03-08T09:30:00.000Z").toISOString(),
    "2026-03-08T09:30:00.000Z",
  );
  assert.equal(normalizeCreateTaskFormDate("2026-02-30"), undefined);
  assert.equal(
    normalizeCreateTaskFormDate("2026-02-30T09:30:00.000Z"),
    undefined,
  );
  assert.equal(normalizeCreateTaskFormDate("March 8, 2026"), undefined);
  assert.equal(normalizeCreateTaskFormDate("not-a-date"), undefined);
  assert.equal(normalizeCreateTaskFormDate(new Date("invalid")), undefined);
  assert.equal(normalizeCreateTaskFormDate(null), undefined);
  assert.equal(normalizeCreateTaskFormDate(undefined), undefined);
});
