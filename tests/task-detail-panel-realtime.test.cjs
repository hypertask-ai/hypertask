// HTPR-6281: after a remote task:changed, the open detail side panel must not
// keep mount-time priority/estimate/labels, and the getTask refetch must not
// reuse a cached GET.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/task-detail-panel-realtime.test.cjs"), {
  interopDefault: true,
});

const {
  refreshTaskDetailQueryCache,
  seedTaskDetailSatelliteCaches,
} = jiti(path.join(root, "src/lib/realtime/taskDetailRefresh.ts"));

test("seedTaskDetailSatelliteCaches writes priority and estimate keys and invalidates labels", async () => {
  const writes = [];
  const invalidated = [];
  const queryClient = {
    setQueryData: (key, data) => writes.push({ key, data }),
    invalidateQueries: async ({ queryKey }) => {
      invalidated.push(queryKey);
    },
  };

  seedTaskDetailSatelliteCaches(queryClient, {
    id: 6281,
    priority: { id: "p-high", Priority_Value: "High" },
    estimate: { estimate_index: 2 },
  });

  assert.deepEqual(writes, [
    {
      key: ["priority", 6281],
      data: { id: "p-high", Priority_Value: "High" },
    },
    { key: ["estimate", 6281], data: { estimate_index: 2 } },
  ]);
  assert.deepEqual(invalidated, [["taskLabels", 6281]]);
});

test("refreshTaskDetailQueryCache seeds side-panel caches from the fetched task", async () => {
  const writes = [];
  const invalidated = [];
  const queryClient = {
    cancelQueries: async () => undefined,
    setQueryData: (key, data) => writes.push({ key, data }),
    invalidateQueries: async ({ queryKey }) => {
      invalidated.push(queryKey);
    },
  };
  const fetched = {
    id: 6281,
    projectId: 15,
    uniqueIndex: 6281,
    title: "Updated",
    section: "Bugs",
    priority: { id: "p-high", Priority_Value: "High" },
    estimate: null,
  };

  const task = await refreshTaskDetailQueryCache({
    queryClient,
    taskId: 6281,
    fetchTask: async () => fetched,
  });

  assert.equal(task, fetched);
  assert.ok(
    writes.some(
      (entry) =>
        entry.key[0] === "task-" &&
        entry.key[1] === 6281 &&
        entry.data === fetched
    )
  );
  assert.ok(
    writes.some(
      (entry) =>
        entry.key[0] === "priority" &&
        entry.data?.Priority_Value === "High"
    )
  );
  assert.ok(
    writes.some(
      (entry) => entry.key[0] === "estimate" && entry.data === null
    )
  );
  assert.deepEqual(invalidated, [["taskLabels", 6281]]);
});

test("realtime task detail fetch uses cache no-store", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/realtime/useTaskCommentsRealtime.ts"),
    "utf8"
  );
  assert.match(source, /cache:\s*["']no-store["']/);
  assert.match(source, /TASK_DETAIL_REALTIME_FETCH_CACHE\s*=\s*["']no-store["']/);
});
