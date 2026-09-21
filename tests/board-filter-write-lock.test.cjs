const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const loadHelper = ({ existingLabelIds, smartLabels = [], savedViews = [] }) => {
  const events = [];
  const tx = {
    $queryRaw: async () => {
      events.push("lock");
      return [{ id: "project-view-15" }];
    },
    label: {
      findMany: async ({ where }) => {
        if (where.id?.in) {
          events.push(`validate:${where.id.in.join(",")}`);
          return existingLabelIds.map((id) => ({ id }));
        }
        events.push("smart-labels");
        return smartLabels;
      },
    },
    view: {
      findFirst: async ({ where }) => {
        events.push(`target:${where.id}`);
        return savedViews.find((view) => view.id === where.id) ?? null;
      },
      findMany: async () => {
        events.push("saved-views");
        return savedViews;
      },
    },
  };
  const prisma = {
    $transaction: async (operation) => operation(tx),
  };
  delete require.cache[path.join(root, "src/lib/prisma.ts")];
  delete require.cache[path.join(
    root,
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts",
  )];
  stubModule("src/lib/prisma.ts", { default: prisma });
  const jiti = require("jiti")(
    path.join(root, `tests/board-filter-write-lock-${++loadId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return {
    events,
    tx,
    helper: jiti(path.join(
      root,
      "src/utils/controllers/projects/views/boardFilterWriteLock.ts",
    )),
  };
};

const filters = (labelId) => ({
  matchFilters: "ALL",
  addedFilters: [
    { type: "Labels", searchPayload: [{ id: labelId }] },
  ],
});

test("a filter write locks the board and validates labels before persisting", async () => {
  const { events, helper } = loadHelper({ existingLabelIds: ["label-1"] });

  const result = await helper.withBoardFilterWriteLock(
    15,
    filters("label-1"),
    async () => {
      events.push("write");
      return "saved";
    },
  );

  assert.equal(result, "saved");
  assert.deepEqual(events, ["lock", "validate:label-1", "write"]);
});

test("native view creation uses the validating board-filter write helper", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(root, "src/lib/mcp/views/services.ts"),
    "utf8",
  );
  const createView = source.slice(source.indexOf("export async function createView"), source.indexOf("export type UpdateViewInput"));
  assert.match(createView, /withBoardFilterWriteLock\(projectId, board_filters/);
});

test("a writer waiting behind deletion rejects a missing label before writing", async () => {
  const { events, helper } = loadHelper({ existingLabelIds: [] });

  await assert.rejects(
    helper.withBoardFilterWriteLock(15, filters("deleted-label"), async () => {
      events.push("write");
    }),
    (error) => error?.status === 409 && /no longer exists/i.test(error.message),
  );

  assert.deepEqual(events, ["lock", "validate:deleted-label"]);
});

test("generic mutation guard rejects paired smart-split views", async () => {
  const smartView = { id: "split-1", board_filters: filters("split-1") };
  const smartLabel = {
    id: "split-1",
    value: "Quick wins",
    ai_prompt: "Tasks that are quick wins",
  };
  const { helper, tx } = loadHelper({
    existingLabelIds: [],
    smartLabels: [smartLabel],
    savedViews: [smartView],
  });

  await assert.rejects(
    helper.assertViewIsNotManagedSmartSplit(tx, 15, smartView.id),
    (error) => error?.status === 409 && /manage this smart split/i.test(error.message),
  );
});

test("generic mutation guard rejects legacy smart-split views", async () => {
  const legacyView = {
    id: "legacy-view",
    board_filters: filters("legacy-label"),
  };
  const legacyLabel = {
    id: "legacy-label",
    value: "Needs design",
    ai_prompt: "Tasks that need design",
  };
  const { helper, tx } = loadHelper({
    existingLabelIds: [],
    smartLabels: [legacyLabel],
    savedViews: [legacyView],
  });

  await assert.rejects(
    helper.assertViewIsNotManagedSmartSplit(tx, 15, legacyView.id),
    (error) => error?.status === 409 && /manage this smart split/i.test(error.message),
  );
});

test("every concurrent existing-board filter writer participates in the lock protocol", () => {
  const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

  assert.equal(
    (source("src/pages/api/projects/views/create-view.ts").match(/withBoardFilterWriteLock\(/g) ?? []).length,
    2,
  );
  assert.equal(
    (source("src/pages/api/projects/views/update-view.ts").match(/withBoardFilterWriteLock\(/g) ?? []).length,
    1,
  );
  assert.equal(
    (source("src/pages/api/projects/views/unsaved-view.ts").match(/withBoardFilterWriteLock\(/g) ?? []).length,
    2,
  );
  assert.equal(
    (source("src/lib/mcp/views/services.ts").match(/withBoardFilterWriteLock\(/g) ?? []).length,
    1,
  );
  assert.equal(
    (source("src/pages/api/projects/views/create-view.ts").match(/assertViewIsNotManagedSmartSplit\(/g) ?? []).length,
    1,
  );
  assert.equal(
    (source("src/pages/api/projects/views/update-view.ts").match(/assertViewIsNotManagedSmartSplit\(/g) ?? []).length,
    1,
  );
  assert.equal(
    (source("src/lib/mcp/views/services.ts").match(/assertViewIsNotManagedSmartSplit\(/g) ?? []).length,
    2,
  );
  assert.equal(
    (source("src/pages/api/projects/views/smart-split.ts").match(/acquireBoardFilterWriteLock\(tx, projectId\)/g) ?? []).length,
    3,
  );
  assert.equal(
    (source("src/pages/api/labels/updateLabel.ts").match(/acquireBoardFilterWriteLock\(tx, actualProjectId\)/g) ?? []).length,
    1,
  );
  assert.equal(
    (source("src/pages/api/labels/updateLabel.ts").match(/acquireBoardFilterWriteLock\(tx, existingLabelProjectId\)/g) ?? []).length,
    1,
  );
  assert.equal(
    (source("src/pages/api/projects/views/delete-rename-view.ts").match(/assertViewIsNotManagedSmartSplit\(/g) ?? []).length,
    2,
  );
});
