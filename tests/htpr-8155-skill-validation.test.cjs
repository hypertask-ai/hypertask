const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

function harness({ failure } = {}) {
  const reports = [];
  const writes = [];
  const skill = { id: 17, name: "Review", slug: "review", body: "Review changes", userId: 985, projectId: null };
  const save = async ({ data }) => {
    if (failure) throw failure;
    writes.push(data);
    return { ...skill, ...data };
  };
  const mocks = {
    "@/lib/prisma": { default: { aI_Skill: {
      findFirst: async () => skill,
      create: save,
      update: save,
    } } },
    "@/lib/errors/reportError": { reportError: async report => reports.push(report) },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ id: 985 }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
    "@/lib/auth/getSessionUser": {},
    "@/lib/agentRuns/model": {},
    "@/lib/ai/prompts/registry": {},
    "@/app/api/ai/_lib/modelProvider": {},
    "@/app/api/ai/_lib/byokKeys": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  };
  return {
    reports, writes,
    create: load("src/app/api/ai/skills/route.ts", mocks).POST,
    update: load("src/app/api/ai/skills/[id]/route.ts", mocks).PATCH,
  };
}

for (const method of ["POST", "PATCH"]) {
  async function call(h, data) {
    const request = new NextRequest("https://app.hypertask.ai/api/ai/skills/17", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    return method === "POST" ? h.create(request) : h.update(request, { params: Promise.resolve({ id: "17" }) });
  }

  for (const [input, error] of [
    [{ name: " \n\t ", body: "Review changes" }, "Skill name is required"],
    [{ markdown: " \n\t " }, "Skill name is required"],
    [{ markdown: "---\nname: Review\n" }, "SKILL.md frontmatter is not closed"],
    [{ markdown: "---\nname: Review\n---\n" }, 'Skill "Review" has an empty body'],
    [{ markdown: "# !!!\nReview changes" }, "Skill name must contain a letter or number"],
  ]) {
    test(`${method}: invalid skill input stays a 400 without an incident: ${error}`, async () => {
      const h = harness();
      const response = await call(h, input);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error });
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.reports, []);
    });
  }

  test(`${method}: a valid skill still saves`, async () => {
    const h = harness();
    const response = await call(h, { name: "Review", body: "Review changes" });
    assert.equal(response.status, method === "POST" ? 201 : 200);
    const { skill } = await response.json();
    assert.equal(skill.name, "Review");
    assert.equal(skill.body, "Review changes");
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.reports, []);
  });

  test(`${method}: unexpected errors with matching text still report`, async () => {
    const failure = new Error("Skill name is required");
    const h = harness({ failure });
    const response = await call(h, { name: "Review", body: "Review changes" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Skill name is required" });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].message, failure.message);
    assert.equal(h.reports[0].stack, failure.stack);
    assert.deepEqual(h.writes, []);
  });
}
