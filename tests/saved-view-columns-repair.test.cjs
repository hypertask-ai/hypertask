const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const { loadModule } = require("./helpers/loadModule.cjs");

let emptyViews = [];
let boardColumns = new Map();
let updates = [];
let filed = [];
let existingTicket = null;
let redisSets = [];
let redisSetResult = "OK";
let redisDeletes = [];
let skippedBoards = 0;

const prisma = {
  $queryRaw: async (strings) => {
    const sql = Array.isArray(strings) ? strings.join(" ") : String(strings);
    if (/COUNT\(DISTINCT/.test(sql)) return [{ boards: BigInt(skippedBoards) }];
    return emptyViews;
  },
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

const { GET, REPAIR_TICKET_TITLE, repairTicketDescription, repairTicketMarker } = loadModule(
  "src/app/api/cron/saved-view-columns/route.ts",
  {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/redis": { getRedis: async () => redis },
    "@/utils/controllers/section/viewHelpers": {
      boardColumnsForProject: async (projectId) => boardColumns.get(projectId) ?? [],
    },
    "@/utils/controllers/tasks/createTaskCore": {
      createProvisionedTaskCore: async (options) => {
        filed.push(options);
        return { task: { id: 4711, uniqueIndex: 9001 } };
      },
    },
  },
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
  boardColumns = new Map([[41, columnsFor(41)], [42, []]]);
  updates = [];
  filed = [];
  existingTicket = null;
  redisSets = [];
  redisSetResult = "OK";
  redisDeletes = [];
  skippedBoards = 0;
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
});
test.afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

test("an unauthenticated call is refused and repairs nothing", async () => {
  assert.equal((await callRoute("")).status, 401);
  assert.deepEqual(updates, []);
  assert.deepEqual(filed, []);
});

test("a view with no column list gets its board's columns and files one ticket naming board and views", async () => {
  const response = await callRoute();
  assert.equal(response.status, 200);
  assert.deepEqual(updates, [
    { viewId: "view-1", columns: columnsFor(41) },
    { viewId: "view-2", columns: columnsFor(41) },
  ]);
  assert.equal(filed.length, 1);
  const ticket = filed[0];
  assert.equal(ticket.title, REPAIR_TICKET_TITLE);
  assert.equal(ticket.userId, 332);
  assert.equal(ticket.creationChannel, "api");
  assert.deepEqual([ticket.projectId, ticket.sectionId, ticket.sectionTitle], [15, 4389, "Backlog"]);
  assert.deepEqual(ticket.labelIds, ["ff65d1a5-0aa5-4fa9-8eab-4d5fa7833f1b"]);
  for (const text of ["Client Board", "Sprint", "Bugs only", "What's wrong or wanted:", "How to undo:"]) {
    assert.match(ticket.description, new RegExp(text));
  }
  const body = await response.json();
  assert.equal(body.viewsRepaired, 2);
  assert.deepEqual(body.boards, [{ projectId: 41, board: "Client Board", views: ["Sprint", "Bugs only"] }]);
  assert.deepEqual(body.ticket, { filed: true, taskId: 4711, ticket: 9001 });
});

test("a quiet day and a board with no live columns repair nothing and file nothing", async () => {
  emptyViews = [];
  let body = await (await callRoute()).json();
  assert.deepEqual([updates, filed, body.viewsRepaired, body.ticket], [[], [], 0, null]);
  emptyViews = [{ id: "view-9", title: "Blank", projectId: 42, board: "Blank Board" }];
  skippedBoards = 1;
  body = await (await callRoute()).json();
  assert.deepEqual([updates, filed, body.boardsWithoutColumns, body.ticket], [[], [], 1, null]);
});

test("every board left alone is counted, even when the batch is full of them", async () => {
  skippedBoards = 108;
  emptyViews = Array.from({ length: 200 }, (_, index) => ({
    id: `blank-${index}`,
    title: `Blank ${index}`,
    projectId: 500 + index,
    board: "Blank Board",
  }));
  boardColumns = new Map();
  const body = await (await callRoute()).json();
  assert.deepEqual([updates, filed, body.viewsRepaired, body.boardsWithoutColumns, body.truncated], [[], [], 0, 108, true]);
});

test("a same-day retry skips and an existing ticket for the day is not filed twice", async () => {
  redisSetResult = null;
  assert.deepEqual(await (await callRoute()).json(), { skipped: "already ran today" });
  assert.deepEqual([updates, filed], [[], []]);
  assert.match(redisSets[0][0], /^saved-view-columns:run:\d{4}-\d{2}-\d{2}$/);
  redisSetResult = "OK";
  existingTicket = { id: 88, uniqueIndex: 9002 };
  assert.deepEqual((await (await callRoute()).json()).ticket, { filed: false, taskId: 88, ticket: 9002 });
  assert.deepEqual(filed, []);
});

test("a failed run releases the day gate so the next run can retry", async () => {
  const failing = async () => {
    throw new Error("database unavailable");
  };
  prisma.$executeRaw = failing;
  try {
    assert.equal((await callRoute()).status, 500);
    assert.deepEqual(filed, []);
    assert.match(redisDeletes[0], /^saved-view-columns:run:\d{4}-\d{2}-\d{2}$/);
  } finally {
    prisma.$executeRaw = async (strings, ...values) => {
      updates.push({ columns: JSON.parse(values[0]), viewId: values[1] });
      return 1;
    };
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
      boardsWithoutColumns: 2,
      truncated: false,
    },
    now,
  );
  for (const text of ["saved-view-columns:2026-11-10", "Client Board", "Sprint", "2 boards left alone because they had no live columns"]) {
    assert.match(description, new RegExp(text));
  }
  assert.doesNotMatch(description, /still waiting/);
  const capped = repairTicketDescription(
    {
      viewsFound: 200,
      viewsRepaired: 92,
      boards: [{ projectId: 41, board: "Client Board", views: ["Sprint"] }],
      boardsWithoutColumns: 108,
      truncated: true,
    },
    now,
  );
  assert.match(capped, /More views are still waiting/);
});
