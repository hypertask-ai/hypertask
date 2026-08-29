const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const picker = fs.readFileSync(
  path.join(root, "src/components/Modals/commands/searchTasks.tsx"),
  "utf8",
);
const route = fs.readFileSync(
  path.join(root, "src/pages/api/tasks/searchAll.ts"),
  "utf8",
);
const recentTasks = fs.readFileSync(
  path.join(root, "src/utils/controllers/tasks/getRecentlyWorkedTasks.ts"),
  "utf8",
);

function loadTypeScript(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (request) => stubs[request] ?? require(request);

  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    localRequire,
  );
  return loadedModule.exports.default ?? loadedModule.exports;
}

function responseRecorder() {
  const result = { status: null, body: null };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

function loadRecentRoute(identity) {
  const recentCalls = [];
  const handler = loadTypeScript("src/pages/api/tasks/searchAll.ts", {
    "@/lib/auth/cookieIdentity": {
      verifyCookieIdentity: async () => identity,
    },
    "@/utils/controllers/tasks/searchAll": {
      __esModule: true,
      default: async () => ({ status: 200, json: [] }),
    },
    "@/utils/controllers/tasks/getRecentlyWorkedTasks": {
      __esModule: true,
      default: async (input) => {
        recentCalls.push(input);
        return { status: 200, json: [{ id: 10, title: "Allowed task" }] };
      },
    },
  });
  return { handler, recentCalls };
}

async function callRecentRoute(handler) {
  const { response, result } = responseRecorder();
  await handler(
    {
      method: "POST",
      body: {
        mode: "recent",
        projectIds: [15, 99],
        currentTaskId: 42,
      },
      cookies: { nookies_user: "claim", ht_session: "signature" },
    },
    response,
  );
  return result;
}

function loadRecentController({ fail = false } = {}) {
  const queries = [];
  const rows = [
    {
      id: 1,
      projectId: 15,
      userId: 6,
      updatedByUserIds: [6],
      archivedAt: null,
      deletedAt: null,
      status: "Normal",
      updatedAt: new Date("2026-08-13T10:00:00Z"),
    },
    {
      id: 2,
      projectId: 99,
      userId: 6,
      updatedByUserIds: [6],
      archivedAt: null,
      deletedAt: null,
      status: "Normal",
      updatedAt: new Date("2026-08-13T11:00:00Z"),
    },
    {
      id: 3,
      projectId: 15,
      userId: 9,
      updatedByUserIds: [],
      archivedAt: null,
      deletedAt: null,
      status: "Normal",
      updatedAt: new Date("2026-08-13T12:00:00Z"),
    },
    {
      id: 4,
      projectId: 15,
      userId: 6,
      updatedByUserIds: [6],
      archivedAt: new Date("2026-08-13T09:00:00Z"),
      deletedAt: null,
      status: "Normal",
      updatedAt: new Date("2026-08-13T09:00:00Z"),
    },
    {
      id: 42,
      projectId: 15,
      userId: 6,
      updatedByUserIds: [6],
      archivedAt: null,
      deletedAt: null,
      status: "Normal",
      updatedAt: new Date("2026-08-13T13:00:00Z"),
    },
  ];

  const controller = loadTypeScript(
    "src/utils/controllers/tasks/getRecentlyWorkedTasks.ts",
    {
      "@/lib/prisma": {
        __esModule: true,
        default: {
          task: {
            findMany: async (query) => {
              queries.push(query);
              if (fail) throw new Error("database unavailable");

              const allowedProjects =
                query.where.project?.accessibleProjectIds ??
                rows.map((row) => row.projectId);
              return rows.filter(
                (row) =>
                  query.where.projectId.in.includes(row.projectId) &&
                  allowedProjects.includes(row.projectId) &&
                  row.id !== query.where.id?.not &&
                  row.archivedAt === query.where.archivedAt &&
                  row.deletedAt === query.where.deletedAt &&
                  row.status === query.where.status &&
                  (row.userId === 6 || row.updatedByUserIds.includes(6)),
              );
            },
          },
        },
      },
      "@/utils/controllers/projects/getAllIncludes": {
        getProjectWhere: (userId) => ({
          accessibleProjectIds: userId === 6 ? [15] : [],
        }),
      },
    },
  );
  return { controller, queries };
}

test("the relation picker loads recently worked tasks before a search", () => {
  assert.match(picker, /mode:\s*"recent"/);
  assert.match(picker, /currentTaskId/);
  assert.match(picker, /Recently worked/);
  assert.match(picker, /No recently worked tasks yet/);
  assert.match(picker, /Couldn&apos;t load tasks\. Try searching again\./);
  assert.match(picker, /<ModalHintBar\s*\/>/);
});

test("recent task lookup is authenticated and board-scoped", () => {
  assert.match(route, /mode === "recent"/);
  assert.match(route, /verifyCookieIdentity\(/);
  assert.match(route, /req\.cookies\.ht_session/);
  assert.match(route, /identity\.status !== "verified"/);
  assert.match(route, /status\(401\)/);
  assert.match(recentTasks, /project:\s*getProjectWhere\(userId\)/);
  assert.match(recentTasks, /updatedByUserIds:\s*\{ has: userId \}/);
});

test("the recent route rejects an unverified identity before querying tasks", async () => {
  const { handler, recentCalls } = loadRecentRoute({
    status: "unauthenticated",
  });
  const result = await callRecentRoute(handler);

  assert.equal(result.status, 401);
  assert.deepEqual(recentCalls, []);
});

test("the recent route passes only the verified identity to the controller", async () => {
  const { handler, recentCalls } = loadRecentRoute({
    status: "verified",
    id: 6,
  });
  const result = await callRecentRoute(handler);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [{ id: 10, title: "Allowed task" }]);
  assert.deepEqual(recentCalls, [
    { userId: 6, projectIds: [15, 99], currentTaskId: 42 },
  ]);
});

test("the controller returns worked tasks only from accessible boards", async () => {
  const { controller, queries } = loadRecentController();
  const result = await controller({
    userId: 6,
    projectIds: [15, 99],
    currentTaskId: 42,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(
    result.json.map(({ id }) => id),
    [1],
  );
  assert.deepEqual(queries[0].where.project, { accessibleProjectIds: [15] });
});

test("the controller fails closed when its task query fails", async () => {
  const { controller } = loadRecentController({ fail: true });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await controller({ userId: 6, projectIds: [15] });
    assert.deepEqual(result, { status: 500, json: [] });
  } finally {
    console.error = originalError;
  }
});

test("the current, archived, and deleted tasks are absent from suggestions", () => {
  assert.match(recentTasks, /id:\s*\{ not: currentTaskId \}/);
  assert.match(recentTasks, /deletedAt:\s*null/);
  assert.match(recentTasks, /archivedAt:\s*null/);
  assert.match(recentTasks, /status:\s*"Normal"/);
  assert.match(recentTasks, /take:\s*10/);
  assert.match(recentTasks, /orderBy:\s*\{ updatedAt: "desc" \}/);
});
