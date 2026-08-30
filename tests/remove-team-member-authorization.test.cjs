const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function modulePath(relativePath) {
  return path.join(root, relativePath);
}

function stubModule(relativePath, exports) {
  const filename = modulePath(relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function resetModules(relativePaths) {
  for (const relativePath of relativePaths) {
    delete require.cache[modulePath(relativePath)];
  }
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/remove-team-member-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(modulePath(relativePath));
  return typeof loaded === "function" ? loaded : loaded.default ?? loaded;
}

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "remove-team-member-test-secret";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function loadRoute(
  controllerResponse = { status: 200, json: { message: "Success" } },
) {
  const calls = [];
  resetModules([
    "src/pages/api/members/removeTeamMember.ts",
    "src/utils/controllers/teams/leave.ts",
  ]);
  stubModule("src/utils/controllers/teams/leave.ts", {
    leaveTeam: async (...args) => {
      calls.push(args);
      return controllerResponse;
    },
  });
  return {
    handler: loadTs("src/pages/api/members/removeTeamMember.ts"),
    calls,
  };
}

function loadController({
  ownerId = 6,
  removedCount = 1,
  teamUpdateCount = 1,
} = {}) {
  const calls = {
    transaction: 0,
    memberTeamDeletes: [],
    assigneeDeletes: [],
    followerDeletes: [],
    memberDeletes: [],
    teamUpdates: [],
    sync: [],
    firstProject: [],
  };
  const tx = {
    team: {
      findUnique: async () =>
        ownerId === null ? null : { googleAccount: { userId: ownerId } },
      updateMany: async (args) => {
        calls.teamUpdates.push(args);
        return { count: teamUpdateCount };
      },
    },
    member_Team: {
      deleteMany: async (args) => {
        calls.memberTeamDeletes.push(args);
        return { count: removedCount };
      },
    },
    assignees: {
      deleteMany: async (args) => {
        calls.assigneeDeletes.push(args);
        return { count: 1 };
      },
    },
    follower: {
      deleteMany: async (args) => {
        calls.followerDeletes.push(args);
        return { count: 1 };
      },
    },
    member: {
      deleteMany: async (args) => {
        calls.memberDeletes.push(args);
        return { count: 1 };
      },
    },
  };

  resetModules([
    "src/utils/controllers/teams/leave.ts",
    "src/lib/prisma.ts",
    "src/lib/syncSeatBilling.ts",
    "src/utils/controllers/projects/getFirst.ts",
  ]);
  stubModule("src/lib/prisma.ts", {
    default: {
      $transaction: async (run) => {
        calls.transaction += 1;
        return run(tx);
      },
    },
  });
  stubModule("src/lib/syncSeatBilling.ts", {
    mutateAndSyncSeatBilling: async (teamId, mutate, options) => {
      const mutation = await mutate(() => {});
      calls.sync.push({ teamId, mutation, options });
      return { value: mutation.value, billing: "OK" };
    },
  });
  stubModule("src/utils/controllers/projects/getFirst.ts", {
    default: async (userId) => {
      calls.firstProject.push(userId);
      return { id: 10 };
    },
  });

  return {
    leaveTeam: loadTs("src/utils/controllers/teams/leave.ts").leaveTeam,
    calls,
  };
}

test("the route rejects an unsigned request before removal", async () => {
  const { handler, calls } = loadRoute();
  const response = responseRecorder();

  await handler(
    { method: "POST", cookies: {}, body: { teamId: "team-1", userId: 8 } },
    response,
  );

  assert.equal(response.statusCode, 401);
  assert.equal(calls.length, 0);
});

test("the route passes the verified caller identity into the controller", async () => {
  const { signSession, SESSION_COOKIE } = loadTs("src/lib/auth/session.ts");
  const { handler, calls } = loadRoute();
  const response = responseRecorder();

  await handler(
    {
      method: "POST",
      cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) },
      body: { teamId: "team-1", userId: 8 },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [["team-1", 8, 6]]);
});

test("the route forwards controller authorization failures", async () => {
  const { signSession, SESSION_COOKIE } = loadTs("src/lib/auth/session.ts");
  const { handler } = loadRoute({
    status: 403,
    json: { message: "Only the team owner can remove members" },
  });
  const response = responseRecorder();

  await handler(
    {
      method: "POST",
      cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) },
      body: { teamId: "team-1", userId: 8 },
    },
    response,
  );

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /team owner/i);
});

test("a non-owner cannot mutate another member inside the team transaction", async () => {
  const { leaveTeam, calls } = loadController({ ownerId: 99 });

  const result = await leaveTeam("team-1", 8, 6);

  assert.equal(result.status, 403);
  assert.equal(calls.transaction, 1);
  assert.equal(calls.memberTeamDeletes.length, 0);
  assert.equal(calls.assigneeDeletes.length, 0);
  assert.equal(calls.followerDeletes.length, 0);
  assert.equal(calls.memberDeletes.length, 0);
  assert.equal(calls.teamUpdates.length, 0);
  assert.equal(calls.sync[0].mutation.sync, false);
  assert.equal(calls.firstProject.length, 0);
});

test("an authenticated member can remove only themselves", async () => {
  const { leaveTeam, calls } = loadController({ ownerId: 99 });

  const result = await leaveTeam("team-1", 6, 6);

  assert.equal(result.status, 200);
  assert.deepEqual(calls.memberTeamDeletes[0].where, {
    userId: 6,
    teamId: "team-1",
  });
  assert.deepEqual(calls.teamUpdates[0].where, { id: "team-1" });
  assert.equal(calls.sync[0].mutation.sync, true);
});

test("an owner atomically removes one membership and decrements one seat", async () => {
  const { leaveTeam, calls } = loadController();

  const result = await leaveTeam("team-1", 8, 6);

  assert.equal(result.status, 200);
  assert.deepEqual(calls.memberTeamDeletes[0].where, {
    userId: 8,
    teamId: "team-1",
    team: { googleAccount: { userId: 6 } },
  });
  assert.equal(calls.assigneeDeletes.length, 1);
  assert.equal(calls.followerDeletes.length, 1);
  assert.equal(calls.memberDeletes.length, 1);
  assert.deepEqual(calls.teamUpdates[0], {
    where: {
      id: "team-1",
      googleAccount: { userId: 6 },
    },
    data: { totalSeats: { decrement: 1 } },
  });
  assert.equal(calls.sync[0].mutation.sync, true);
  assert.deepEqual(calls.sync[0].options, { exact: true });
  assert.deepEqual(calls.firstProject, [8]);
});

test("an already-absent membership cleans stale relations without changing billing", async () => {
  const { leaveTeam, calls } = loadController({ removedCount: 0 });

  const result = await leaveTeam("team-1", 8, 6);

  assert.equal(result.status, 200);
  assert.equal(calls.assigneeDeletes.length, 1);
  assert.equal(calls.followerDeletes.length, 1);
  assert.equal(calls.memberDeletes.length, 1);
  assert.equal(calls.teamUpdates.length, 0);
  assert.equal(calls.sync[0].mutation.sync, false);
});

test("a missing team returns 404 without destructive queries", async () => {
  const { leaveTeam, calls } = loadController({ ownerId: null });

  const result = await leaveTeam("team-1", 8, 6);

  assert.equal(result.status, 404);
  assert.equal(calls.memberTeamDeletes.length, 0);
  assert.equal(calls.assigneeDeletes.length, 0);
  assert.equal(calls.teamUpdates.length, 0);
  assert.equal(calls.sync[0].mutation.sync, false);
});

test("a failed conditional seat update fails the transaction", async () => {
  const { leaveTeam, calls } = loadController({ teamUpdateCount: 0 });

  const result = await leaveTeam("team-1", 8, 6);

  assert.equal(result.status, 400);
  assert.equal(calls.transaction, 1);
  assert.equal(calls.teamUpdates.length, 1);
  assert.equal(calls.sync.length, 0);
});
