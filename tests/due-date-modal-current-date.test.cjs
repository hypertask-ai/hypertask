const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

require.extensions[".css"] = () => {};
require.extensions[".scss"] = () => {};

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    })
  : jitiModule(__filename, {
      interopDefault: true,
      cache: false,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });

const { resolveDueDateForModal } = jiti(
  path.join(root, "src/components/Modals/DueDate/index.tsx"),
);

test("the due-date modal uses the task detail date before its query catches up", () => {
  const detailDueDate = new Date("2026-09-01T09:00:00.000Z");
  const staleQueriedDueDate = new Date("2026-08-28T09:00:00.000Z");

  assert.equal(
    resolveDueDateForModal("Update", detailDueDate, staleQueriedDueDate),
    detailDueDate,
  );
});

test("the due-date modal still falls back to its task query outside task detail", () => {
  const queriedDueDate = new Date("2026-09-02T09:00:00.000Z");

  assert.equal(
    resolveDueDateForModal("Update", undefined, queriedDueDate),
    queriedDueDate,
  );
  assert.equal(resolveDueDateForModal("Create", undefined, queriedDueDate), null);
});
