const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { cookies } = require("next/headers");
const { load } = require("./task-route-loader.cjs");
const { graph, getProjectWhere, projectRow, relationFields, visibility } = require("./legacy-task-relations-fixture.cjs");
const projectContract = require("./htpr-6509-query-contracts.json").project;
const taskContract = require("./legacy-task-relations-contract.json");
const { projectContentAccessWhere } = load("src/utils/controllers/projects/getAllIncludes.ts", {
  "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
  "@/utils/controllers/notifications/visibleInboxScope": {},
});

const savedEnv = Object.fromEntries(["SESSION_SECRET", "BETTER_AUTH_ENABLED", "AUTH_LEGACY_FAST_PATH"].map((name) => [name, process.env[name]]));
process.env.SESSION_SECRET = "isolated-pages-rest-handler-test-secret";
process.env.BETTER_AUTH_ENABLED = "1";
process.env.AUTH_LEGACY_FAST_PATH = "0";
test.after(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const { signSession } = load("src/lib/auth/session.ts", {});

function fixture(options = {}) {
  const { userId = 985, token = signSession({ id: userId }), profileId = userId, betterAuthId } = options;
  const compat = Object.hasOwn(options, "compat") ? options.compat : "htpr-6924";
  const calls = { projects: [], tasks: [], sessions: [] };
  const database = {
    project: { findFirst: async (args) => {
      calls.projects.push(args);
      return projectContract.json.json;
    } },
    task: { findMany: async (args) => {
      calls.tasks.push(args);
      assert.deepEqual(args.where.project, getProjectWhere(userId));
      return graph().map((item) => projectRow("Task", item, args));
    } },
  };
  const mocks = {
    "@/lib/prisma": { default: database },
    "@/lib/agentRuns/model": {},
    "@/lib/auth/betterAuth": { auth: { api: { getSession: async ({ headers }) => {
      calls.sessions.push(headers.get("cookie"));
      return betterAuthId === undefined ? null : { user: { id: String(betterAuthId) } };
    } } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere, projectContentAccessWhere },
    "@/lib/agents/visibility": visibility,
  };
  async function invoke(route, { method = "POST", noCache = false } = {}) {
    const handler = load(`src/pages/api/${route}.ts`, mocks).default;
    const url = new URL(`http://127.0.0.1/api/${route}?userId=6`);
    for (const value of compat === undefined ? [] : Array.isArray(compat) ? compat : [compat]) url.searchParams.append("compat", value);
    const query = Object.fromEntries([...new Set(url.searchParams.keys())].map((name) => {
      const values = url.searchParams.getAll(name);
      return [name, values.length === 1 ? values[0] : values];
    }));
    const server = http.createServer((req, res) => {
      res.sendDate = false;
      void apiResolver(req, res, query, { default: handler }, { dev: false }, false);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await new Promise((resolve, reject) => {
        const request = http.request({
          host: "127.0.0.1", port: server.address().port, path: url.pathname + url.search, method,
          headers: {
            "content-type": "application/json", connection: "close", "x-user-id": "6",
            cookie: [token ? `ht_session=${token}` : "", profileId == null ? "" : `nookies_user=${encodeURIComponent(JSON.stringify({ id: profileId }))}`].filter(Boolean).join("; "),
            ...(noCache ? { "cache-control": "no-cache" } : {}),
          },
        }, (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { text += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, text, headers: response.headers }));
          response.on("error", reject);
        });
        request.on("error", reject);
        request.end(method === "POST" ? JSON.stringify({ projectId: 15, userId: 6, compact: true }) : undefined);
      });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
  return { invoke, calls };
}

for (const [name, options] of [
  ["signed session", {}],
  ["owner signed session", { userId: 6 }],
  ["session without profile cookie", { profileId: null }],
  ["stale Better Auth account", { betterAuthId: 7 }],
  ["Better Auth-only session", { token: null, profileId: null, betterAuthId: 985 }],
  ["ordinary user", { userId: 7 }],
  ["no-cache request", { noCache: true }],
]) {
  test(`${name} retires detail and selects compact getAll through the Pages API resolver`, async () => {
    assert.throws(() => cookies(), /outside a request scope/);
    const f = fixture(options);
    const detail = await f.invoke("projects/detail", options);
    assert.equal(detail.status, 410);
    assert.equal(detail.text, '{"error":"Legacy project detail has been retired","replacement":"/api/projects/boardTasks"}');
    assert.deepEqual(f.calls.projects, []);
    const tasks = await f.invoke("tasks/getAll");
    assert.equal(tasks.status, 200);
    const compact = JSON.parse(tasks.text);
    assert.deepEqual(Object.keys(compact[0].subTasks[0]), [...relationFields, "createdAt"]);
    assert.deepEqual(Object.keys(compact[0].parentTask), [...relationFields, "subTasks"]);
    assert.deepEqual(Object.keys(compact[0].parentTask.subTasks[0]), relationFields);
    assert.equal(compact[0].subTasks.some((item) => item.status === "Deleted"), false);
    assert.equal(f.calls.sessions.length, 2);
  });
}

for (const [name, options] of [
  ["absent opt-in", { compat: undefined }],
  ["wrong opt-in", { compat: "other" }],
  ["duplicate opt-in", { compat: ["htpr-6924", "htpr-6924"] }],
]) {
  test(`${name} keeps legacy detail/getAll bytes and HTTP headers with production identity resolution`, async () => {
    for (const [route, expectedText] of [["projects/detail", JSON.stringify(projectContract.json.json)], ["tasks/getAll", taskContract.text]]) {
      const f = fixture(options);
      const response = await f.invoke(route);
      const baseline = await fixture({ ...options, compat: "other" }).invoke(route);
      assert.deepEqual(response, baseline);
      assert.equal(response.status, 200);
      assert.equal(response.text, expectedText);
      if (route === "projects/detail") {
        assert.equal(f.calls.projects.length, 1);
        assert.deepEqual(f.calls.projects[0].where, { id: 15, status: "Normal", ...projectContentAccessWhere(options.userId ?? 985) });
        assert.deepEqual(f.calls.projects[0].include, projectContract.args.include);
        assert.equal(f.calls.projects[0].relationLoadStrategy, "join");
      }
      if (route === "tasks/getAll") {
        const legacy = JSON.parse(response.text);
        assert.ok(legacy[0].subTasks[0].description.length > 0);
        assert.ok(legacy[0].parentTask.description.length > 0);
      }
    }
  });
}

for (const [name, token] of [["unsigned", null], ["forged", "forged"], ["expired", signSession({ id: 985 }, -1)]]) {
  test(`${name} identity cannot enable either path via body, query, header or profile`, async () => {
    const f = fixture({ token, profileId: 6 });
    const detail = await f.invoke("projects/detail");
    assert.equal(detail.status, 401);
    assert.equal(detail.text, '{"message":"Unauthorized"}');
    assert.deepEqual(f.calls.projects, []);
    const tasks = await f.invoke("tasks/getAll");
    assert.equal(tasks.status, 401);
    assert.equal(tasks.text, '{"message":"Unauthorized"}');
    assert.deepEqual(f.calls.tasks, []);
  });
}

test("both real Pages handlers retain POST-only handling before identity probes", async () => {
  const f = fixture();
  for (const route of ["projects/detail", "tasks/getAll"]) {
    const response = await f.invoke(route, { method: "GET" });
    assert.equal(response.status, 405);
    assert.equal(response.text, '{"message":"Method not allowed"}');
  }
  assert.deepEqual(f.calls, { projects: [], tasks: [], sessions: [] });
});
