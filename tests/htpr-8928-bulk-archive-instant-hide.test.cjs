const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const flagFile = "src/lib/flags/definitions/htpr-8928-bulk-archive-instant-hide.ts";
const bulkFile = "src/lib/contexts/Kanban/BulkSelectionContext.tsx";
const boardFile = "src/hooks/MultiPages/useUpdateTaskInBoards.tsx";
const homepageFile =
  "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx";

test("ticket flag is registered with everyone default", () => {
  const jiti = require("jiti")(__filename);
  const { FEATURE_FLAG_DEFINITIONS } = jiti(
    path.join(root, "src/lib/flags/definitions.ts"),
  );
  const key = "htpr-8928-bulk-archive-instant-hide";
  const definition = FEATURE_FLAG_DEFINITIONS.find((flag) => flag.key === key);
  assert.ok(definition, "generated registry contains the ticket flag");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("bulk archive instant path hides before background persist", () => {
  for (const file of [boardFile, bulkFile, homepageFile]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    if (file === boardFile) {
      assert.match(source, /optimisticOnly\?: boolean/);
      assert.match(source, /if \(options\.optimisticOnly\)/);
    }
    if (file === bulkFile) {
      assert.match(source, /HTPR_8928_BULK_ARCHIVE_INSTANT_HIDE_FLAG/);
      assert.match(source, /onArchiveSelectedBatch/);
      assert.match(source, /bulkArchiveInstantHide/);
      assert.match(source, /clearSelection\(\)/);
      assert.match(source, /void onArchiveSelectedBatch/);
    }
    if (file === homepageFile) {
      assert.match(source, /archiveSelectedBatchForBulk/);
      assert.match(source, /optimisticOnly: true/);
      assert.match(source, /Promise\.allSettled/);
    }
  }
  assert.match(fs.readFileSync(path.join(root, flagFile), "utf8"), /htpr-8928-bulk-archive-instant-hide/);
});
