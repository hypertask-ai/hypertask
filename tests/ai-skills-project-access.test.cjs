const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const flagKey = "htpr-6966-skills-access-denial";

function harness({ mode = null, denied = true, failure, user = { id: 2343 } } = {}) {
  const calls = [];
  const prisma = {
    project: {
      findFirst: async (query) => {
        calls.push(["access", query]);
        if (failure) throw failure;
        return denied ? null : { id: query.where.id, teamId: "team-1" };
      },
    },
    featureFlag: {
      findUnique: async ({ where }) => {
        calls.push(["flag", where.key]);
        return mode ? { mode } : null;
      },
    },
    aI_Skill: {
      findMany: async (query) => { calls.push(["list", query]); return []; },
      create: async (query) => { calls.push(["create", query]); return { id: 1 }; },
    },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/errors/reportError": { reportError: async (report) => calls.push(["report", report]) },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => user },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId) => ({ members: { some: { userId } } }) },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => assert.fail("No session lookup expected") },
    "@/lib/agentRuns/model": {},
    "@/lib/ai/prompts/registry": {},
    "@/app/api/ai/_lib/modelProvider": {},
    "@/app/api/ai/_lib/byokKeys": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  };
  return { route: load("src/app/api/ai/skills/route.ts", mocks), calls, prisma, mocks };
}

function request(method, projectId = 15) {
  return new NextRequest(`https://app.hypertask.ai/api/ai/skills?projectId=${projectId}`, {
    method,
    ...(method === "POST" ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", projectId, name: "Review", body: "Review changes" }),
    } : {}),
  });
}

for (const method of ["GET", "POST"]) {
  test(`${method}: expected project denial returns 404 without reporting or reading/writing skills`, async () => {
    const h = harness();
    const response = await h.route[method](request(method));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Project not found or access denied" });
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", "flag"]);
    assert.equal(h.calls[0][1].where.id, 15);
    assert.equal(h.calls[0][1].where.members.some.userId, 2343);
    assert.equal(h.calls[1][1], flagKey);
  });

  test(`${method}: flag Off preserves the legacy 400 and handled error report`, async () => {
    const h = harness({ mode: "OFF" });
    const response = await h.route[method](request(method));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Project not found or access denied" });
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", "flag", "report"]);
    const report = h.calls.at(-1)[1];
    assert.equal(report.message, "Project not found or access denied");
    assert.equal(report.source, "handled");
    assert.equal(report.url, "/api/ai/skills");
    assert.deepEqual(report.extra, { stage: "request" });
  });

  test(`${method}: unexpected database errors remain reported, without consulting the flag`, async () => {
    const failure = new Error("Database unavailable");
    const h = harness({ failure });
    const response = await h.route[method](request(method));
    assert.equal(response.status, 400);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", "report"]);
    assert.equal(h.calls.at(-1)[1].stack, failure.stack);
  });

  test(`${method}: matching text on a generic error is not mistaken for a typed access denial`, async () => {
    const h = harness({ failure: new Error("Project not found or access denied") });
    assert.equal((await h.route[method](request(method))).status, 400);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", "report"]);
  });

  test(`${method}: an accessible project keeps numeric authorization and the original successful response`, async () => {
    const h = harness({ denied: false });
    const response = await h.route[method](request(method));
    assert.equal(response.status, method === "GET" ? 200 : 201);
    assert.deepEqual(await response.json(), method === "GET" ? { skills: [] } : { skill: { id: 1 } });
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", method === "GET" ? "list" : "create"]);
    assert.equal(h.calls[0][1].where.id, 15);
  });

  test(`${method}: unauthenticated callers still get 401 without accessing data or flags`, async () => {
    const h = harness({ user: null });
    assert.equal((await h.route[method](request(method))).status, 401);
    assert.deepEqual(h.calls, []);
  });
}

test("the real flag registry declares a bugfix that defaults to Everyone and respects stored Off", async () => {
  const h = harness();
  const flags = load("src/lib/flags.ts", h.mocks);
  assert.equal(flags.HTPR_6966_SKILLS_ACCESS_DENIAL_FLAG, flagKey);
  assert.equal(await flags.isFeatureEnabled(flagKey, 2343), true);
  assert.equal(await flags.featureFlagCandidateUserIds(flagKey), null);
  const off = harness({ mode: "OFF" });
  assert.equal(await load("src/lib/flags.ts", off.mocks).isFeatureEnabled(flagKey, 2343), false);
});
