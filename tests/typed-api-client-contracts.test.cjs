const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const contracts = load("src/lib/api/contracts/settingsReads.ts", {});
const client = load("src/lib/api/typedClient.ts", {});
const row = {
  id: 1, projectId: null, userId: 6, slug: "review", name: "Review",
  description: null, argumentHint: null, body: "Review changes", sourceUrl: null,
  enabled: true, createdById: null,
  createdAt: new Date("2026-10-06T00:00:00Z"), updatedAt: new Date("2026-10-06T00:00:00Z"),
};
const memory = { enabled: true, memories: [{ content: "Use member", createdAt: "historical date", source: "legacy-source" }] };
const wireRow = JSON.parse(JSON.stringify(row));
let user;
let denied;
let teamAllowed;
let rows;
let memoryState;
const calls = [];
class AccessError extends Error {}
class ProjectAccessError extends Error {
  constructor() { super("Project not found or access denied"); }
}
const mocks = {
  "@/lib/flags": { isFeatureEnabled: async () => false },
  "@/lib/errors/reportError": { reportError: async () => calls.push(["report"]) },
  "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => user },
  "@/app/api/ai/_lib/customInstructions": {
    ProjectAccessError,
    assertProjectAccess: async (...args) => {
      calls.push(["access", ...args]);
      if (denied) throw new ProjectAccessError();
    },
  },
  "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => assert.fail("unused GET dependency") },
  "@/utils/controllers/teams/hasTeamMembershipAccess": {
    hasTeamMembershipAccess: async (...args) => { calls.push(["team", ...args]); return teamAllowed; },
  },
  "@/lib/prisma": { default: { aI_Skill: {
    findMany: async (input) => { calls.push(["skills", input]); return rows; },
  } } },
  "@/app/api/ai/_lib/boardMemory": {
    BoardMemoryProjectAccessError: AccessError,
    getBoardMemoryState: async (...args) => {
      calls.push(["memory", ...args]);
      if (denied) throw new AccessError();
      return memoryState;
    },
  },
};
mocks["./customInstructions"] = mocks["@/app/api/ai/_lib/customInstructions"];
mocks["@/lib/redis"] = { getRedis: () => assert.fail("GET must not contact Redis") };
const skillsRoute = load("src/app/api/ai/skills/route.ts", mocks);
const memoryRoute = load("src/app/api/ai/project/memory/route.ts", mocks);
const request = (path, params = {}) => {
  const url = new URL(path, "https://app.hypertask.ai");
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, value);
  return new NextRequest(url);
};

async function body(response, status, schema) {
  assert.equal(response.status, status);
  const data = await response.json();
  assert.deepEqual(schema.parse(data), data);
  return data;
}

const originalAdapter = axios.defaults.adapter;
test.beforeEach(() => {
  user = { id: 6 }; denied = false; teamAllowed = true;
  rows = [row]; memoryState = memory; calls.length = 0;
  axios.defaults.adapter = async () => assert.fail("Tests must never make live HTTP requests");
});
test.afterEach(() => { axios.defaults.adapter = originalAdapter; });

test("actual skills GET serializes every Prisma scalar and matches the contract", async () => {
  assert.deepEqual(await body(await skillsRoute.GET(request("/api/ai/skills")), 200, contracts.skillsListResponseSchema), { skills: [wireRow] });
  assert.deepEqual(calls, [["skills", { where: { OR: [{ userId: 6, projectId: null }] }, orderBy: [{ name: "asc" }, { id: "asc" }] }]]);
});

test("actual skills GET project/team queries preserve access, filters and ordering", async () => {
  for (const projectId of ["15", " 15 ", "1e1", "0x10", "", undefined]) {
    calls.length = 0;
    const input = { projectId, teamId: " team-1 " };
    const parsed = contracts.skillsListQuerySchema.parse(input);
    await body(await skillsRoute.GET(request("/api/ai/skills", input)), 200, contracts.skillsListResponseSchema);
    const id = parsed.projectId;
    assert.deepEqual(calls, [
      ...(id ? [["access", 6, id]] : []), ["team", 6, "team-1"],
      ["skills", { where: { OR: [{ userId: 6, projectId: null }, ...(id ? [{ projectId: id, userId: null }] : [])] }, orderBy: [{ name: "asc" }, { id: "asc" }] }],
    ]);
  }
});

test("actual skills GET invalid query, permission and auth errors match the error contract", async () => {
  for (const projectId of ["0", "-1", "1.5", "no", " "]) {
    calls.length = 0;
    assert.equal(contracts.skillsListQuerySchema.safeParse({ projectId }).success, false);
    const data = await body(await skillsRoute.GET(request("/api/ai/skills", { projectId })), 400, contracts.apiReadErrorSchema);
    assert.equal(data.error, "projectId must be a positive integer");
    assert.deepEqual(calls, [["report"]]);
  }
  teamAllowed = false;
  await body(await skillsRoute.GET(request("/api/ai/skills", { teamId: "team-1" })), 403, contracts.apiReadErrorSchema);
  denied = true;
  await body(await skillsRoute.GET(request("/api/ai/skills", { projectId: 15 })), 400, contracts.apiReadErrorSchema);
  user = null; calls.length = 0;
  await body(await skillsRoute.GET(request("/api/ai/skills")), 401, contracts.apiReadErrorSchema);
  assert.deepEqual(calls, []);
});

test("actual GET handlers match full and empty response contracts", async () => {
  assert.deepEqual(await body(await memoryRoute.GET(request("/api/ai/project/memory", { projectId: 15 })), 200, contracts.boardMemoryResponseSchema), memory);
  assert.deepEqual(calls, [["memory", 6, 15]]);
  rows = []; memoryState = { enabled: false, memories: [] };
  assert.deepEqual(await body(await skillsRoute.GET(request("/api/ai/skills")), 200, contracts.skillsListResponseSchema), { skills: [] });
  assert.deepEqual(await body(await memoryRoute.GET(request("/api/ai/project/memory", { projectId: 15 })), 200, contracts.boardMemoryResponseSchema), memoryState);
});

test("memory query coercion matches actual GET, including error responses", async () => {
  for (const projectId of ["15", " 15 ", "1e1", "0x10", null, "", "0", "-1", "1.5", "no"]) {
    calls.length = 0;
    const parsed = contracts.boardMemoryQuerySchema.safeParse({ projectId });
    await body(await memoryRoute.GET(request("/api/ai/project/memory", { projectId })), parsed.success ? 200 : 400, parsed.success ? contracts.boardMemoryResponseSchema : contracts.apiReadErrorSchema);
    assert.deepEqual(calls, parsed.success ? [["memory", 6, parsed.data.projectId]] : []);
  }
  denied = true;
  await body(await memoryRoute.GET(request("/api/ai/project/memory", { projectId: 15 })), 404, contracts.apiReadErrorSchema);
  user = null; calls.length = 0;
  await body(await memoryRoute.GET(request("/api/ai/project/memory", { projectId: 15 })), 401, contracts.apiReadErrorSchema);
  assert.deepEqual(calls, []);
});

test("contracts reject real shape drift but retain forward-compatible fields", () => {
  for (const data of [{ ...memory, enabled: "true" }, { ...memory, memories: {} }, { ...memory, memories: [{ ...memory.memories[0], createdAt: new Date() }] }, { ...memory, memories: [{ content: null, createdAt: "date", source: "source" }] }]) {
    assert.equal(contracts.boardMemoryResponseSchema.safeParse(data).success, false);
  }
  for (const field of Object.keys(wireRow)) {
    const missing = { ...wireRow }; delete missing[field];
    assert.equal(contracts.skillResponseSchema.safeParse(missing).success, false, field);
  }
  for (const changes of [{ enabled: "true" }, { createdAt: new Date() }, { updatedAt: null }, { name: null }, { projectId: "15" }, { createdById: "6" }]) {
    assert.equal(contracts.skillResponseSchema.safeParse({ ...wireRow, ...changes }).success, false);
  }
  assert.equal(contracts.skillsListResponseSchema.safeParse({ skills: {} }).success, false);
  assert.deepEqual(contracts.skillResponseSchema.parse({ ...wireRow, future: "kept" }), { ...wireRow, future: "kept" });
});

for (const [name, invoke, url, params, data] of [
  ["getBoardMemory", () => client.getBoardMemory(15), "/api/ai/project/memory", { projectId: 15 }, memory],
  ["listSkills", () => client.listSkills({ projectId: 15, teamId: "team-1" }), "/api/ai/skills", { projectId: 15, teamId: "team-1" }, { skills: [wireRow] }],
]) {
  test(`${name} validates success with one bare Axios request and typed-only header`, async (t) => {
    const seen = [];
    t.mock.method(axios.defaults, "adapter", async (config) => {
      seen.push(config);
      return { data: JSON.stringify({ ...data, future: true }), status: 200, statusText: "OK", headers: {}, config };
    });
    const response = await invoke();
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { ...data, future: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "get"); assert.equal(seen[0].url, url);
    assert.deepEqual(seen[0].params, params);
    assert.equal(seen[0].headers.get("X-Hypertask-Client"), "htpr-6925");
    assert.equal(seen[0].baseURL, undefined); assert.equal(seen[0].timeout, 0);
  });

  test(`${name} preserves HTTP rejection identity, status and payload without retry`, async (t) => {
    let count = 0;
    const payload = { error: "Access denied", future: true };
    const error = new axios.AxiosError("Request failed with status code 403", "ERR_BAD_REQUEST", {}, null, { status: 403, data: payload });
    t.mock.method(axios.defaults, "adapter", async () => { count++; throw error; });
    t.mock.method(console, "warn", () => assert.fail("HTTP errors must not be schema-rewritten"));
    await assert.rejects(invoke(), (caught) => caught === error && caught.response.status === 403 && caught.response.data === payload);
    assert.equal(count, 1);
  });

  test(`${name} warns on mismatch and returns original parsed data without retry`, async (t) => {
    let count = 0;
    const drift = name === "listSkills" ? { skills: [{ ...wireRow, createdAt: null }] } : { ...memory, enabled: "true" };
    const warnings = [];
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    t.mock.method(axios.defaults, "adapter", async (config) => {
      count++;
      return { data: drift, status: 200, headers: {}, config };
    });
    const response = await invoke();
    assert.equal(response.data, drift);
    assert.equal(count, 1); assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], new RegExp(name));
    assert.ok(warnings[0][1].length > 0);
  });
}
