const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/board-realtime-reconciliation-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  }
);

const { reconcileActiveBoardQuery } = jiti(
  path.join(root, "src/lib/boardSync/reconcileActiveBoardQuery.ts")
);

test("board reconciliation expires the active board snapshot before refetching projects", async () => {
  const operations = [];
  const queryClient = {
    invalidateQueries: async (filters) => {
      const matchingQueries = [
        ["boardTasks", 6, 15],
        ["boardTasks", 7, 15],
        ["boardTasks", 6, 16],
        ["projectsAll"],
      ].filter((queryKey) => filters.predicate({ queryKey }));
      operations.push(["invalidate", matchingQueries]);
    },
    refetchQueries: async (filters) => {
      operations.push(["refetch", filters]);
    },
  };

  await reconcileActiveBoardQuery(queryClient, 15);

  assert.deepEqual(operations, [
    [
      "invalidate",
      [
        ["boardTasks", 6, 15],
        ["boardTasks", 7, 15],
      ],
    ],
    ["refetch", { queryKey: ["projectsAll"] }],
  ]);
});
