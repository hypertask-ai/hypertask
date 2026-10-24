const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

function harness({ denied = true, failure, user = { id: 2343 } } = {}) {
  const calls = [];
  const prisma = {
    project: {
      findFirst: async (query) => {
        calls.push(["access", query]);
        if (failure) throw failure;
        return denied ? null : { id: query.where.id, teamId: "team-1" };
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
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access"]);
    assert.equal(h.calls[0][1].where.id, 15);
    assert.equal(h.calls[0][1].where.members.some.userId, 2343);
  });

  test(`${method}: unexpected database errors remain reported`, async () => {
    const failure = new Error("Database unavailable");
    const h = harness({ failure });
    const response = await h.route[method](request(method));
    assert.equal(response.status, 400);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", "report"]);
    const report = h.calls.at(-1)[1];
    assert.equal(report.stack, failure.stack);
    assert.equal(report.message, failure.message);
    assert.equal(report.source, "handled");
    assert.equal(report.url, "/api/ai/skills");
    assert.deepEqual(report.extra, { stage: "request" });
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

  test(`${method}: unauthenticated callers still get 401 without accessing data`, async () => {
    const h = harness({ user: null });
    assert.equal((await h.route[method](request(method))).status, 401);
    assert.deepEqual(h.calls, []);
  });
}

test("the retired skills access-denial flag is absent from the registry", () => {
  const h = harness();
  const flags = load("src/lib/flags.ts", h.mocks);
  assert.equal(flags.HTPR_6966_SKILLS_ACCESS_DENIAL_FLAG, undefined);
  assert.equal(flags.FEATURE_FLAG_KEYS.includes("htpr-6966-skills-access-denial"), false);
});

for (const teamScope of [undefined, null, { teamId: "team-1" }]) {
  test(`skill errors preserve legacy status unless the credential is team-bound (${JSON.stringify(teamScope)})`, async () => {
    const { skillErrorResponse } = load("src/app/api/ai/_lib/skillAccess.ts", {
      "@/lib/prisma": { default: {} },
      "@/utils/controllers/projects/getAllIncludes": {},
      "./customInstructions": {},
    });
    const principal = { userId: 2343, agentId: null, teamScope };
    assert.equal(skillErrorResponse(new Error("Project not found or access denied"), principal).status, teamScope == null ? 400 : 403);
    assert.equal(skillErrorResponse(new Error("Database unavailable"), principal).status, 400);
  });
}

const manualSkillBody = "Review Done tickets.\n```html\n<ticket>Keep the evidence</ticket>\n```\n" + "Long instructions. ".repeat(2000).trimEnd();

for (const [name, markdown, expectedName, expectedBody, description] of [
  ["Done column triage", manualSkillBody, "Done column triage", manualSkillBody, null],
  ["", "---\nname: Markdown review\ndescription: Check the board.\n---\nReview changes.", "Markdown review", "Review changes.", "Check the board."],
  ["Fallback name", "---\nname: Frontmatter name\n---\nReview changes.", "Frontmatter name", "Review changes.", null],
]) {
  test(`Settings markdown persists, reloads and resolves for chat: ${expectedName}`, async () => {
    const h = harness({ denied: false });
    const saved = [];
    h.prisma.aI_Skill.create = async ({ data }) => {
      const skill = { id: 17, sourceUrl: null, ...data };
      saved.push(skill);
      return skill;
    };
    h.prisma.aI_Skill.findMany = async ({ where }) => {
      assert.ok(where.OR.some(scope => scope.projectId === 15 && scope.userId === null));
      return saved.filter(skill => !where.slug || where.slug.in.includes(skill.slug));
    };
    const response = await h.route.POST(new NextRequest("https://app.hypertask.ai/api/ai/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", projectId: 15, name, markdown }),
    }));
    assert.equal(response.status, 201);
    const { skill } = await response.json();
    assert.equal(skill.name, expectedName);
    assert.equal(skill.body, expectedBody);
    assert.equal(skill.description, description);
    assert.equal(skill.projectId, 15);
    assert.equal(skill.userId, null);
    assert.equal(skill.enabled, true);
    const reloaded = await h.route.GET(request("GET"));
    assert.equal(reloaded.status, 200);
    assert.deepEqual((await reloaded.json()).skills, [skill]);
    const { resolveSkillsForAiRequest } = load("src/app/api/ai/_lib/chatSkillResolution.ts", h.mocks);
    const resolved = await resolveSkillsForAiRequest(`/${skill.slug} Review this board`, { userId: 2343, projectId: 15 });
    assert.equal(resolved.cleanedText, "Review this board");
    assert.deepEqual(resolved.skills, [skill]);
    assert.ok(resolved.systemPromptAddition.includes(expectedBody));
  });
}

test("a board member does not need an administrator role to save a manually named skill", async () => {
  const h = harness({ denied: false });
  const response = await h.route.POST(new NextRequest("https://app.hypertask.ai/api/ai/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "project", projectId: 15, name: "Member skill", markdown: "Review changes." }),
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(h.calls[0][1].where, { id: 15, members: { some: { userId: 2343 } } });
  assert.equal(h.calls.find(([kind]) => kind === "create")[1].data.body, "Review changes.");
});

for (const [name, markdown, expectedError] of [
  ["", "Review changes.", "Skill name is required"],
  ["Large skill", "x".repeat(64 * 1024 + 1), 'Skill "Large skill" exceeds the 64KB body limit'],
]) {
  test(`manual skill validation returns a specific error without persisting: ${expectedError}`, async () => {
    const h = harness({ denied: false });
    const response = await h.route.POST(new NextRequest("https://app.hypertask.ai/api/ai/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", projectId: 15, name, markdown }),
    }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: expectedError });
    assert.deepEqual(h.calls.map(([kind]) => kind), ["access", "report"]);
  });
}

test("duplicate manual skill names return a specific conflict instead of success", async () => {
  const { Prisma } = require("@prisma/client");
  const h = harness({ denied: false });
  h.prisma.aI_Skill.create = async () => {
    throw new Prisma.PrismaClientKnownRequestError("Duplicate skill", { code: "P2002", clientVersion: "test" });
  };
  const response = await h.route.POST(new NextRequest("https://app.hypertask.ai/api/ai/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "project", projectId: 15, name: "Done column triage", markdown: "Review changes." }),
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "A skill with this slug already exists in this scope" });
});
