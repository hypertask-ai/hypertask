const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});

const {
  reconcileActiveBoardQuery,
  reconcileActiveBoardTasks,
} = jiti(
  path.join(root, "src/lib/boardSync/reconcileActiveBoardQuery.ts"),
);
const {
  shouldUseScopedBoardReconcile,
} = jiti(
  path.join(root, "src/lib/realtime/boardRealtimeEventHandler.ts"),
);

const USER_ID = 6;
const PROJECT_ID = 15;
const PROJECTS_ALL_KEY = ["projectsAll"];

const changedPayload = {
  project: { id: PROJECT_ID, name: "Renamed by someone else" },
  tasks: [{ id: 900, title: "Changed on another device" }],
  allViews: [],
};

const buildProjects = () => [
  { id: 7, name: "Another board", section: [], tasks: [{ id: 1 }] },
  { id: PROJECT_ID, name: "Product board", section: [], tasks: [{ id: 2 }] },
  { id: 22, name: "Third board", section: [], tasks: [{ id: 3 }] },
];

const buildQueryClient = (
  projects,
  accountId = USER_ID,
  { fetchShouldThrow = false } = {},
) => {
  const operations = [];
  let cached =
    projects === null
      ? undefined
      : { accountId, updatedProjects: projects };
  return {
    operations,
    cachedProjects: () => cached?.updatedProjects,
    queryClient: {
      fetchQuery: async ({ queryKey }) => {
        operations.push(["fetch", queryKey]);
        if (fetchShouldThrow) throw new Error("forbidden");
        return changedPayload;
      },
      getQueryData: (queryKey) =>
        queryKey[0] === PROJECTS_ALL_KEY[0] ? cached : undefined,
      setQueryData: (queryKey, value) => {
        if (queryKey[0] !== PROJECTS_ALL_KEY[0]) return;
        cached = typeof value === "function" ? value(cached) : value;
      },
      invalidateQueries: async (filters) => {
        operations.push(["invalidate", filters]);
      },
      refetchQueries: async (filters) => {
        operations.push(["refetch", filters.queryKey]);
      },
    },
  };
};

test("a board change event fetches only that board, never the whole project list", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects());

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations, [["fetch", ["boardTasks", USER_ID, PROJECT_ID]]]);
});

test("a board change event patches only the changed project into the account list", async () => {
  const { queryClient, cachedProjects } = buildQueryClient(buildProjects());
  const before = cachedProjects();

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  const after = cachedProjects();
  assert.equal(after.length, before.length);
  assert.equal(after[1].name, "Renamed by someone else");
  assert.deepEqual(after[1].tasks, changedPayload.tasks);
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
});

test("a board change with no account list falls back to the full reconcile", async () => {
  const { queryClient, operations } = buildQueryClient(null);

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.equal(
    operations[1][1].predicate({
      queryKey: ["boardTasks", USER_ID, PROJECT_ID],
    }),
    true,
  );
  assert.deepEqual(operations[2], ["refetch", PROJECTS_ALL_KEY]);
});

test("a board missing from the account list falls back to the full reconcile", async () => {
  const { queryClient, operations } = buildQueryClient([
    { id: 7, name: "Another board", section: [], tasks: [] },
  ]);

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[2], ["refetch", PROJECTS_ALL_KEY]);
});

test("a response fetched under another account never patches the current list", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects(), 99);

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[2], ["refetch", PROJECTS_ALL_KEY]);
});

test("a rejected board fetch falls back to the full reconcile", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects(), USER_ID, {
    fetchShouldThrow: true,
  });

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[2], ["refetch", PROJECTS_ALL_KEY]);
});

test("the full reconcile still expires the board snapshot and refetches the list", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects());

  await reconcileActiveBoardQuery(queryClient, PROJECT_ID);

  assert.equal(
    operations[0][1].predicate({
      queryKey: ["boardTasks", USER_ID, PROJECT_ID],
    }),
    true,
  );
  assert.deepEqual(operations[1], ["refetch", PROJECTS_ALL_KEY]);
});

test("the hook routing uses the scoped path only for flagged change events", () => {
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: true,
      trigger: "event",
      userId: USER_ID,
    }),
    true,
  );
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: false,
      trigger: "event",
      userId: USER_ID,
    }),
    false,
  );
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: true,
      trigger: "reconnect",
      userId: USER_ID,
    }),
    false,
  );
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: true,
      trigger: "event",
      userId: undefined,
    }),
    false,
  );
});

test("useBoardRealtime still wires the extracted handler and scoped route", () => {
  const source = require("fs").readFileSync(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );
  assert.match(source, /createBoardRealtimeEventHandler/);
  assert.match(source, /useFlag\(SCOPED_BOARD_REFETCH_FLAG\)/);
  assert.match(source, /scopedRefetch && trigger === "event"/);
  assert.match(source, /reconcileActiveBoardTasks/);
});
