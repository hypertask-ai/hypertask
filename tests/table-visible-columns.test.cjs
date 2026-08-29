const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  normalizeTableVisibleColumns,
  seedMissingCustomFieldColumns,
  customFieldColumnKey,
  isCustomFieldColumnKey,
  DEFAULT_TABLE_COLUMNS,
  LOCKED_TABLE_COLUMNS,
  setTableStalenessColumns,
} = jiti(path.join(root, "src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts"));

// HTPR-3805: custom-field table columns were appended after "updated" with no
// width/alignment convention of their own, reading as glued to it. Fixed by
// folding custom fields into the same visible-columns array + reorder/toggle
// mechanism the built-in columns already use (presence = visible, same as
// any built-in column).

test("a stored custom-field key round-trips through normalize like a built-in", () => {
  const stored = ["ticket", "title", customFieldColumnKey("ice-field"), "assignee"];
  assert.deepEqual(normalizeTableVisibleColumns(stored), stored);
});

test("ticket/title stay locked to the front even with a custom field reordered", () => {
  const stored = [customFieldColumnKey("ice-field"), "title", "ticket", "assignee"];
  const result = normalizeTableVisibleColumns(stored);
  assert.deepEqual(result.slice(0, 2), ["ticket", "title"]);
});

test("garbage stored value falls back to the default columns", () => {
  assert.deepEqual(normalizeTableVisibleColumns(["not-a-real-column"]), DEFAULT_TABLE_COLUMNS);
});

test("unchecking a custom field removes it, same as any built-in column", () => {
  const withField = ["ticket", "title", "assignee", customFieldColumnKey("ice-field")];
  const withoutField = withField.filter((key) => key !== customFieldColumnKey("ice-field"));
  // normalize must not resurrect a key the user explicitly removed
  assert.equal(normalizeTableVisibleColumns(withoutField).includes(customFieldColumnKey("ice-field")), false);
});

test("seedMissingCustomFieldColumns appends only fields not already present", () => {
  const visible = ["ticket", "title", "assignee"];
  const seeded = seedMissingCustomFieldColumns(visible, [customFieldColumnKey("ice-field")]);
  assert.deepEqual(seeded, ["ticket", "title", "assignee", customFieldColumnKey("ice-field")]);
});

test("seedMissingCustomFieldColumns is a no-op once a field is already seeded (won't undo a hide)", () => {
  const visible = ["ticket", "title", "assignee"]; // user already unchecked the custom field
  const seeded = seedMissingCustomFieldColumns(visible, []);
  assert.deepEqual(seeded, visible);
});

test("isCustomFieldColumnKey distinguishes custom fields from built-ins", () => {
  assert.equal(isCustomFieldColumnKey(customFieldColumnKey("abc")), true);
  assert.equal(isCustomFieldColumnKey("updated"), false);
});

// HTPR-4987: the header's drag-to-reorder must never move ticket/title — they
// share this lock with the picker's drag-disabled rows, so both surfaces agree.
test("LOCKED_TABLE_COLUMNS locks exactly ticket and title", () => {
  assert.equal(LOCKED_TABLE_COLUMNS.has("ticket"), true);
  assert.equal(LOCKED_TABLE_COLUMNS.has("title"), true);
  assert.equal(LOCKED_TABLE_COLUMNS.has("assignee"), false);
});

test("turning staleness on appends the three age columns without changing the existing order", () => {
  const visible = ["ticket", "title", "assignee", customFieldColumnKey("ice-field")];

  assert.deepEqual(setTableStalenessColumns(visible, true), [
    ...visible,
    "inColumn",
    "noComment",
    "onBoard",
  ]);
});

test("turning staleness on does not duplicate an age column already shown", () => {
  const visible = ["ticket", "title", "inColumn", "assignee"];

  assert.deepEqual(setTableStalenessColumns(visible, true), [
    ...visible,
    "noComment",
    "onBoard",
  ]);
});

test("turning staleness off removes only the age columns", () => {
  const visible = [
    "ticket",
    "title",
    "inColumn",
    "assignee",
    customFieldColumnKey("ice-field"),
    "noComment",
    "onBoard",
  ];

  assert.deepEqual(setTableStalenessColumns(visible, false), [
    "ticket",
    "title",
    "assignee",
    customFieldColumnKey("ice-field"),
  ]);
});
