const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

test("board realtime refreshes an open planning query", () => {
  const source = fs.readFileSync(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );
  assert.match(source, /projectPlanningQueryKey\(projectId\)/);
});

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function resetModules(relativePaths) {
  for (const relativePath of relativePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-project-planning-${++jitiEntryId}.cjs`),
    {
      alias: { "@": path.join(root, "src") },
      cache: false,
      interopDefault: true,
    },
  );
  return jiti(path.join(root, relativePath));
}

function loadRoute({ admin = true, project = undefined, session = { userId: 6 } } = {}) {
  const planningProject =
    project === undefined
      ? {
          id: 15,
          milestones: [
            {
              completedAt: null,
              createdAt: new Date("2026-08-01T09:00:00.000Z"),
              id: "milestone-1",
              targetDate: new Date("2026-09-30T12:00:00.000Z"),
              title: "Public launch",
            },
          ],
          statusUpdates: [
            {
              author: { displayName: "Valentin", id: 6, photoURL: null },
              createdAt: new Date("2026-08-18T09:00:00.000Z"),
              health: "OnTrack",
              id: "update-1",
              message: "The launch remains on schedule.",
            },
          ],
          targetDate: new Date("2026-10-15T12:00:00.000Z"),
        }
      : project;
  const calls = {
    broadcasts: [],
    cyclesEnabled: [],
    milestonesCreated: [],
    milestonesDeleted: [],
    milestonesUpdated: [],
    projectsUpdated: [],
    statusCreated: [],
  };

  resetModules([
    "src/app/api/projects/planning/route.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/cycleService.ts",
    "src/lib/prisma.ts",
    "src/lib/realtime/server.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
    "src/utils/controllers/projects/isProjectAdmin.ts",
  ]);
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => session,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: (userId) => ({ ownerId: userId }),
  });
  stubModule("src/utils/controllers/projects/isProjectAdmin.ts", {
    default: async () => admin,
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: (...args) => calls.broadcasts.push(args),
  });
  stubModule("src/lib/cycleService.ts", {
    getProjectCycleOverview: async () => ({
      current: {
        endDate: "2026-08-31",
        id: 1,
        number: 1,
        projectId: 15,
        rolledOverAt: null,
        startDate: "2026-08-17",
      },
      enabled: calls.cyclesEnabled.at(-1) ?? false,
      next: {
        endDate: "2026-09-14",
        id: 2,
        number: 2,
        projectId: 15,
        rolledOverAt: null,
        startDate: "2026-08-31",
      },
    }),
    setProjectCyclesEnabled: async (projectId, enabled) => {
      calls.cyclesEnabled.push(enabled);
      assert.equal(projectId, 15);
    },
  });
  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async () => planningProject,
        update: async (args) => {
          calls.projectsUpdated.push(args);
          return args.data;
        },
      },
      projectMilestone: {
        create: async (args) => {
          calls.milestonesCreated.push(args);
          return args.data;
        },
        deleteMany: async (args) => {
          calls.milestonesDeleted.push(args);
          return { count: args.where.id === "missing" ? 0 : 1 };
        },
        updateMany: async (args) => {
          calls.milestonesUpdated.push(args);
          return { count: args.where.id === "missing" ? 0 : 1 };
        },
      },
      projectStatusUpdate: {
        create: async (args) => {
          calls.statusCreated.push(args);
          return args.data;
        },
      },
    },
  });

  return {
    ...loadTs("src/app/api/projects/planning/route.ts"),
    calls,
  };
}

function request(method, body) {
  return new NextRequest(
    "https://app.hypertask.ai/api/projects/planning?projectId=15",
    {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    },
  );
}

test("project planning requires a signed-in user", async () => {
  const { GET } = loadRoute({ session: null });
  const response = await GET(request("GET"));
  assert.equal(response.status, 401);
});

test("project planning is hidden without board access", async () => {
  const { GET } = loadRoute({ project: null });
  const response = await GET(request("GET"));
  assert.equal(response.status, 404);
});

test("project planning returns date-only values and management permission", async () => {
  const { GET } = loadRoute();
  const response = await GET(request("GET"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.planning.canManage, true);
  assert.equal(body.planning.targetDate, "2026-10-15");
  assert.equal(body.planning.milestones[0].targetDate, "2026-09-30");
  assert.equal(body.planning.cycles.enabled, false);
  assert.equal(body.planning.cycles.current.number, 1);
});

test("only board admins can enable cycles", async () => {
  const memberRoute = loadRoute({ admin: false });
  const denied = await memberRoute.POST(
    request("POST", { action: "set_cycles", enabled: true, projectId: 15 }),
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(memberRoute.calls.cyclesEnabled, []);

  const adminRoute = loadRoute();
  const enabled = await adminRoute.POST(
    request("POST", { action: "set_cycles", enabled: true, projectId: 15 }),
  );
  assert.equal(enabled.status, 200);
  assert.deepEqual(adminRoute.calls.cyclesEnabled, [true]);
  assert.equal((await enabled.json()).planning.cycles.enabled, true);

  const disabled = await adminRoute.POST(
    request("POST", { action: "set_cycles", enabled: false, projectId: 15 }),
  );
  assert.equal(disabled.status, 200);
  assert.deepEqual(adminRoute.calls.cyclesEnabled, [true, false]);
  assert.equal((await disabled.json()).planning.cycles.enabled, false);
});

test("ordinary members can post a health update", async () => {
  const { POST, calls } = loadRoute({ admin: false });
  const response = await POST(
    request("POST", {
      action: "post_status",
      health: "AtRisk",
      message: "  Vendor   approval is late.  ",
      projectId: 15,
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls.statusCreated[0].data, {
    authorId: 6,
    health: "AtRisk",
    message: "Vendor approval is late.",
    projectId: 15,
  });
  assert.equal(calls.broadcasts.length, 1);
});

test("ordinary members cannot change project dates or milestones", async () => {
  const { POST, calls } = loadRoute({ admin: false });
  const response = await POST(
    request("POST", {
      action: "create_milestone",
      projectId: 15,
      targetDate: "2026-09-30",
      title: "Launch",
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(calls.milestonesCreated.length, 0);
});

test("admins can create a dated milestone", async () => {
  const { POST, calls } = loadRoute();
  const response = await POST(
    request("POST", {
      action: "create_milestone",
      projectId: 15,
      targetDate: "2026-09-30",
      title: "  Public launch  ",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls.milestonesCreated[0].data.title, "Public launch");
  assert.equal(
    calls.milestonesCreated[0].data.targetDate.toISOString(),
    "2026-09-30T12:00:00.000Z",
  );
});

test("invalid calendar dates are rejected", async () => {
  const { POST, calls } = loadRoute();
  const response = await POST(
    request("POST", {
      action: "set_target_date",
      projectId: 15,
      targetDate: "2026-02-31",
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(calls.projectsUpdated.length, 0);
});

test("milestone mutations stay scoped to the selected project", async () => {
  const { POST, calls } = loadRoute();
  const response = await POST(
    request("POST", {
      action: "toggle_milestone",
      completed: true,
      milestoneId: "missing",
      projectId: 15,
    }),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(calls.milestonesUpdated[0].where, {
    id: "missing",
    projectId: 15,
  });
});
