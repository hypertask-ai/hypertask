const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadRoute({ enabled = true, session = { userId: 6 }, task = undefined } = {}) {
  const calls = { boardBroadcasts: [], cycleQueries: [], taskQueries: [], taskBroadcasts: [], writes: [] };
  const cycles = Array.from({ length: 21 }, (_, index) => ({
    id: 11 + index,
    number: index + 1,
    projectId: 15,
    startDate: new Date(Date.UTC(2026, 7, 17 - index * 14)),
    endDate: new Date(Date.UTC(2026, 7, 31 - index * 14)),
    rolledOverAt: index > 1 ? new Date() : null,
  }));
  const foreignCycle = {
    id: 99,
    number: 1,
    projectId: 20,
    startDate: new Date("2026-08-17T00:00:00Z"),
    endDate: new Date("2026-08-31T00:00:00Z"),
    rolledOverAt: null,
  };
  const allCycles = [...cycles, foreignCycle];
  const accessible =
    task === undefined
      ? {
          cycle: cycles[0],
          cycleId: 11,
          id: 50,
          project: { cyclesEnabled: enabled },
          projectId: 15,
        }
      : task;

  for (const relativePath of [
    "src/app/api/tasks/cycle/route.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/cycleService.ts",
    "src/lib/prisma.ts",
    "src/lib/realtime/server.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
    "src/utils/controllers/tasks/single.ts",
  ]) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => session });
  stubModule("src/lib/cycleService.ts", {
    getProjectCycleOverview: async () => ({
      current: { ...cycles[0], startDate: "2026-08-17", endDate: "2026-08-31" },
      enabled,
      next: { ...cycles[1], startDate: "2026-08-31", endDate: "2026-09-14" },
    }),
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: (...args) => calls.boardBroadcasts.push(args),
    broadcastTaskChange: (...args) => calls.taskBroadcasts.push(args),
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    taskWriteAccessWhere: (userId) => ({ writeAccessFor: userId }),
  });
  stubModule("src/utils/controllers/tasks/single.ts", {
    updateTaskSingle: async (...args) => {
      calls.writes.push(args);
      return { json: { id: 50 }, status: 200 };
    },
  });
  stubModule("src/lib/prisma.ts", {
    default: {
      cycle: {
        findMany: async (args) => {
          calls.cycleQueries.push(args);
          const ordered = allCycles
            .filter(
              (cycle) =>
                cycle.projectId === args.where.projectId &&
                (args.where.number === undefined || cycle.number === args.where.number),
            )
            .sort((left, right) => right.startDate - left.startDate || right.id - left.id);
          const cursorIndex = args.cursor
            ? ordered.findIndex(({ id }) => id === args.cursor.id)
            : 0;
          const start = Math.max(0, cursorIndex) + (args.skip ?? 0);
          return ordered.slice(start, start + args.take);
        },
        findUnique: async ({ where }) => allCycles.find(({ id }) => id === where.id) ?? null,
      },
      task: {
        findFirst: async (args) => {
          calls.taskQueries.push(args);
          return accessible;
        },
      },
      user: { findUnique: async () => ({ id: 6, uid: "user-6" }) },
    },
  });

  const jiti = require("jiti")(
    path.join(root, `tests/jiti-task-cycle-${++entryId}.cjs`),
    { alias: { "@": path.join(root, "src") }, cache: false, interopDefault: true },
  );
  return { ...jiti(path.join(root, "src/app/api/tasks/cycle/route.ts")), calls };
}

function request(method, body, query = "taskId=50") {
  return new NextRequest(`https://app.hypertask.ai/api/tasks/cycle?${query}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

test("cycle task routes require authentication and board write access", async () => {
  const signedOut = loadRoute({ session: null });
  assert.equal((await signedOut.GET(request("GET"))).status, 401);
  assert.equal(
    (await signedOut.POST(request("POST", { taskId: 50, cycleId: 11 }))).status,
    401,
  );
  assert.equal(signedOut.calls.writes.length, 0);

  const inaccessible = loadRoute({ task: null });
  assert.equal((await inaccessible.GET(request("GET"))).status, 404);
  assert.equal(
    (await inaccessible.POST(request("POST", { taskId: 50, cycleId: 11 }))).status,
    404,
  );
  assert.deepEqual(inaccessible.calls.taskQueries[0].where.project.writeAccessFor, 6);
  assert.equal(inaccessible.calls.writes.length, 0);
  assert.equal(inaccessible.calls.boardBroadcasts.length, 0);
});

test("cycle history is bounded and only current and next are assignable", async () => {
  const { GET, calls } = loadRoute();
  const response = await GET(request("GET"));
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(calls.cycleQueries[0].take, 21);
  assert.equal(body.cycles.length, 20);
  assert.equal(body.nextCursor, body.cycles[19].id);
  assert.equal(body.cycles[0].assignable, true);
  assert.equal(body.cycles[1].assignable, true);
  assert.equal(body.cycles[2].assignable, false);

  const secondResponse = await GET(
    request("GET", undefined, `taskId=50&cursor=${body.nextCursor}`),
  );
  assert.equal(secondResponse.status, 200);
  const secondBody = await secondResponse.json();
  assert.equal(secondBody.cycles.length, 1);
  assert.equal(secondBody.nextCursor, null);
  assert.equal(calls.cycleQueries[1].cursor.id, body.nextCursor);
  assert.equal(calls.cycleQueries[1].skip, 1);
  assert.equal(
    body.cycles.some(({ id }) => id === secondBody.cycles[0].id),
    false,
  );
});

test("assigning current or next cycle uses the authorized task write path", async () => {
  const { POST, calls } = loadRoute();
  const response = await POST(request("POST", { taskId: 50, cycleId: 12 }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.writes[0][0], { id: 50, cycleId: 12 });
  assert.equal(calls.writes[0][1].id, 6);
  assert.deepEqual(calls.boardBroadcasts, [[15, { originUserId: 6 }]]);
  assert.deepEqual(calls.taskBroadcasts, [[50, { originUserId: 6 }]]);
});

test("history and foreign cycle ids cannot be assigned", async () => {
  const { POST, calls } = loadRoute();
  const history = await POST(request("POST", { taskId: 50, cycleId: 13 }));
  assert.equal(history.status, 400);
  const foreign = await POST(request("POST", { taskId: 50, cycleId: 99 }));
  assert.equal(foreign.status, 400);
  assert.equal(calls.writes.length, 0);
});

test("POST rejects IDs that only coerce to database integers", async () => {
  const { POST, calls } = loadRoute();
  for (const body of [
    { taskId: true, cycleId: 11 },
    { taskId: 50, cycleId: "11" },
    { taskId: 50, cycleId: Number.MAX_SAFE_INTEGER },
  ]) {
    assert.equal((await POST(request("POST", body))).status, 400);
  }
  assert.equal(calls.writes.length, 0);
});

test("disabled cycles reject assignment but still allow clearing", async () => {
  const { POST, calls } = loadRoute({ enabled: false });
  assert.equal(
    (await POST(request("POST", { taskId: 50, cycleId: 11 }))).status,
    409,
  );
  const cleared = await POST(request("POST", { taskId: 50, cycleId: null }));
  assert.equal(cleared.status, 200);
  assert.deepEqual(calls.writes[0][0], { id: 50, cycleId: null });
});
