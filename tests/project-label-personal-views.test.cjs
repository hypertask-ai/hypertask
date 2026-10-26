const test = require("node:test");
const assert = require("node:assert/strict");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");
const loadHelpers = createRefactoredModuleRequire(__dirname, {});
const smartSplits = loadHelpers("../src/lib/smartSplits.ts");
const load = createRefactoredModuleRequire(__dirname, {
  "@/lib/prisma": { default: {} },
  "@/lib/smartSplits": smartSplits,
  "@/models/MyTasksView": { parseMyTasksViewConfig: (value) => value },
});
const { lockMyTasksViewLabels, MissingMyTasksViewLabelError } = load(
  "../src/utils/controllers/tasks/myTasksViews.ts",
);

const config = {
  filters: { labelIds: ["b", "a", "b"] },
  filterSettings: {
    matchFilters: "ALL",
    addedFilters: [{ type: "Labels", match: "ANY", searchPayload: [{ id: "c" }, { id: "a" }] }],
  },
};

test("personal saves lock all flat and rich label references once, in stable order", async () => {
  let query;
  await lockMyTasksViewLabels({ $queryRaw: async (value) => {
    query = value;
    return [{ id: "a" }, { id: "b" }, { id: "c" }];
  } }, config);
  assert.deepEqual(query.values, ["a", "b", "c"]);
  assert.match(query.strings.join(""), /ORDER BY id FOR KEY SHARE/);
});

test("a label deleted before a waiting personal save prevents persistence", async () => {
  let saved = false;
  const persist = async () => {
    await lockMyTasksViewLabels({ $queryRaw: async () => [{ id: "b" }, { id: "c" }] }, config);
    saved = true;
  };
  await assert.rejects(persist, MissingMyTasksViewLabelError);
  assert.equal(saved, false);
  await lockMyTasksViewLabels({ $queryRaw: async () => [{ id: "a" }, { id: "b" }, { id: "c" }] }, config);
});

test("unfiltered personal saves need no label locks", async () => {
  let queried = false;
  await lockMyTasksViewLabels({ $queryRaw: async () => { queried = true; return []; } }, { filters: { labelIds: [] } });
  assert.equal(queried, false);
  await lockMyTasksViewLabels({ $queryRaw: async () => { queried = true; return [{ id: "a" }]; } }, { filters: { labelIds: ["a"] } });
  assert.equal(queried, true);
});
