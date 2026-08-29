const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htc-search-handover-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getSearchTasksHandover } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/searchTasksHandover.ts")
);

test("task search handover is last for a non-empty unmatched query", () => {
  const commandResults = [];
  const handover = getSearchTasksHandover("zzqq");
  const results = [...commandResults, ...(handover ? [handover] : [])];

  assert.equal(results.at(-1)?.key, "searchTasksHandover");
  assert.equal(results.at(-1)?.name, 'Search tasks: "zzqq"');
  assert.equal(results.at(-1)?.payload, "zzqq");
});

test("task search handover is absent for an empty query", () => {
  assert.equal(getSearchTasksHandover(""), null);
  assert.equal(getSearchTasksHandover("   "), null);
});
