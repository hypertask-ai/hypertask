// YPER4-388: getFirst only needs the board's id, columns and views. Loading
// every task with its description made this a 1.3 s query on big boards.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const reads = [];
const board = { id: 15, section: [], project_view: [] };
stubModule("src/lib/prisma.ts", {
  __esModule: true,
  default: {
    user: { findUnique: async () => ({ id: 6 }) },
    project: { findFirst: async (args) => { reads.push(args); return board; } },
  },
});
stubModule("src/utils/helperFunctions/Views/BoardFilterSanitizer.ts", { sanitizeProjectBoardFilters: (project) => project });
stubModule("src/utils/controllers/projects/getAllIncludes.ts", { projectContentAccessWhere: (userId) => ({ ownerId: userId }) });
stubModule("src/utils/controllers/projects/create.ts", { createProjectViewAndCreateDefault: async () => {} });
stubModule("src/utils/controllers/projects/getAll.ts", { getProjectViewInclude: () => true });

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const loaded = jiti(path.join(root, "src/utils/controllers/projects/getFirst.ts"));
const getFirst = typeof loaded === "function" ? loaded : loaded.default;

test("getFirst returns the first board without loading its tasks", async () => {
  const response = await getFirst(6);
  assert.equal(response.status, 200);
  assert.equal(response.json.id, 15);
  assert.ok(reads.length >= 1, "positive control: the board read ran");
  for (const args of reads) {
    assert.equal(args.include.tasks, undefined, "getFirst must not include every task row");
    assert.equal(args.include.section, true);
  }
});
