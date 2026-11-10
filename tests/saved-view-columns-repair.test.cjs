const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");

let emptyViews = [];
let boardColumns = new Map();
let updates = [];
let filed = [];
let existingTicket = null;
let redisSets = [];
let redisSetResult = "OK";
let redisDeletes = [];

const prisma = {
  $queryRaw: async () => emptyViews,
  $executeRaw: async (strings, ...values) => {
    updates.push({ columns: JSON.parse(values[0]), viewId: values[1] });
    return 1;
  },
  task: {
    findFirst: async ({ where }) => {
      assert.equal(where.projectId, 15);
      return existingTicket;
    },
  },
  project: {
    findFirst: async () => ({
      uniqueIdentifier: "HTPR",
      section: [{ id: 4389, section_title: "Backlog" }],
      labels: [{ id: "ff65d1a5-0aa5-4fa9-8eab-4d5fa7833f1b" }],
    }),
  },
};

const redis = {
  set: async (...args) => {
    redisSets.push(args);
    return redisSetResult;
  },
  del: async (key) => {
    redisDeletes.push(key);
    return 1;
  },
};

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/prisma.ts", { __esModule: true, default: prisma });
stubModule("src/lib/redis.ts", { getRedis: async () => redis });
stubModule("src/utils/controllers/section/viewHelpers.ts", {
  boardColumnsForProject: async (projectId) => boardColumns.get(projectId) ?? [],
});
stubModule("src/utils/controllers/tasks/createTaskCore.ts", {
  createProvisionedTaskCore: async (options) => {
    filed.push(options);
    return { task: { id: 4711, uniqueIndex: 9001 } };
  },
});

const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { repairEmptyViewColumns } = jiti(path.join(root, "src/lib/savedViews/repairEmptyViewColumns.ts"));
const { GET, REPAIR_TICKET_TITLE, repairTicketDescription, repairTicketMarker } = jiti(
  path.join(root, "src/app/api/cron/saved-view-columns/route.ts"),
);

const columnsFor = (projectId) => [
  { id: projectId * 10 + 1, section_title: "Todo", ranking: "A1000.000000000000000", title: "Todo", visibility: true },
  { id: projectId * 10 + 2, section_title: "Doing", ranking: "A2000.000000000000000", title: "Doing", visibility: true },
];

const callRoute = (secret = "test-cron-secret") =>
  GET(
    new NextRequest("https://app.hypertask.ai/api/cron/saved-view-columns", {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  );

let previousSecret;
test.beforeEach(() => {
  emptyViews = [
    { id: "view-1", title: "Sprint", projectId: 41, board: "Client Board" },
    { id: "view-2", title: "Bugs only", projectId: 41, board: "Client Board" },
  ];
  boardColumns = new Map([
    [41, columnsFor(41)],
    [42, []],
  ]);
  updates = [];
  filed = [];
  existingTicket = null;
  redisSets = [];
  redisSetResult = "OK";
  redisDeletes = [];
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
});
test.afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

test("an unauthenticated call is refused and repairs nothing", async () => {
  const response = await callRoute("");
  assert.equal(response.status, 401);
  assert.deepEqual(updates, []);
  assert.deepEqual(filed, []);
});

test("a view with no column list gets its board's columns and files one ticket naming board and views", async () => {
  const response = await callRoute();
  assert.equal(response.status, 200);
  assert.deepEqual(updates.map(({ viewId }) => viewId), ["view-1", "view-2"]);
  assert.deepEqual(updates[0].columns, columnsFor(41));
  assert.deepEqual(updates[1].columns, columnsFor(41));

  assert.equal(filed.length, 1);
  assert.equal(filed[0].title, REPAIR_TICKET_TITLE);
  assert.equal(filed[0].userId, 332);
  assert.equal(filed[0].projectId, 15);
  assert.equal(filed[0].sectionId, 4389);
  assert.equal(filed[0].sectionTitle, "Backlog");
  assert.equal(filed[0].creationChannel, "api");
  assert.deepEqual(filed[0].labelIds, ["ff65d1a5-0aa5-4fa9-8eab-4d5fa7833f1b"]);
  assert.match(filed[0].description, /Client Board/);
  assert.match(filed[0].description, /Sprint/);
  assert.match(filed[0].description, /Bugs only/);
  assert.match(filed[0].description, /What's wrong or wanted:/);
  assert.match(filed[0].description, /How to undo:/);

  const body = await response.json();
  assert.equal(body.viewsRepaired, 2);
  assert.deepEqual(body.boards, [{ projectId: 41, board: "Client Board", views: ["Sprint", "Bugs only"] }]);
  assert.deepEqual(body.ticket, { filed: true, taskId: 4711, ticket: 9001 });
});

test("filters and sorting stay untouched: the only write is the column list", async () => {
  const repair = await repairEmptyViewColumns();
  assert.equal(repair.viewsRepaired, 2);
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.deepEqual(Object.keys(update).sort(), ["columns", "viewId"]);
  }
});

test("a quiet day repairs nothing and files nothing", async () => {
  emptyViews = [];
  const response = await callRoute();
  assert.equal(response.status, 200);
  assert.deepEqual(updates, []);
  assert.deepEqual(filed, []);
  const body = await response.json();
  assert.equal(body.viewsRepaired, 0);
  assert.equal(body.ticket, null);
});

test("a board with no live columns is left alone and files nothing", async () => {
  emptyViews = [{ id: "view-9", title: "Empty board view", projectId: 42, board: "Blank Board" }];
  const response = await callRoute();
  assert.equal(response.status, 200);
  assert.deepEqual(updates, []);
  assert.deepEqual(filed, []);
  const body = await response.json();
  assert.equal(body.boardsWithoutColumns, 1);
  assert.equal(body.ticket, null);
});

test("a retry on the same day skips before touching a view", async () => {
  redisSetResult = null;
  const response = await callRoute();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { skipped: "already ran today" });
  assert.deepEqual(updates, []);
  assert.deepEqual(filed, []);
  assert.equal(redisSets.length, 1);
  assert.match(redisSets[0][0], /^saved-view-columns:run:\d{4}-\d{2}-\d{2}$/);
});

test("an existing ticket for the day is not filed twice", async () => {
  existingTicket = { id: 88, uniqueIndex: 9002 };
  const response = await callRoute();
  assert.equal(response.status, 200);
  assert.equal(updates.length, 2);
  assert.deepEqual(filed, []);
  assert.deepEqual((await response.json()).ticket, { filed: false, taskId: 88, ticket: 9002 });
});

test("a failed run releases the day gate so the next run can retry", async () => {
  boardColumns.set(41, columnsFor(41));
  const routePrisma = require(path.join(root, "src/lib/prisma.ts")).default;
  const original = routePrisma.$executeRaw;
  routePrisma.$executeRaw = async () => {
    throw new Error("database unavailable");
  };
  try {
    const response = await callRoute();
    assert.equal(response.status, 500);
    assert.deepEqual(filed, []);
    assert.equal(redisDeletes.length, 1);
    assert.match(redisDeletes[0], /^saved-view-columns:run:\d{4}-\d{2}-\d{2}$/);
  } finally {
    routePrisma.$executeRaw = original;
  }
});

test("the ticket marker and description name the day, the boards and the views", () => {
  const now = new Date("2026-11-10T00:50:00.000Z");
  assert.equal(repairTicketMarker(now), "saved-view-columns:2026-11-10");
  const description = repairTicketDescription(
    {
      viewsFound: 1,
      viewsRepaired: 1,
      boards: [{ projectId: 41, board: "Client Board", views: ["Sprint"] }],
      boardsWithoutColumns: 0,
      truncated: false,
    },
    now,
  );
  assert.match(description, /saved-view-columns:2026-11-10/);
  assert.match(description, /Client Board/);
  assert.match(description, /Sprint/);
});
