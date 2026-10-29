const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const flagKey = "htpr-7781-skill-validation";
const skill = { id: 1, slug: "review", name: "Review", body: "Review changes" };
const importUrl = "https://raw.githubusercontent.com/example/skills/main/review/SKILL.md";

function harness(t, { flag = true, flagFailure, failure, markdown = "---\nname: Review\n---\nReview changes" } = {}) {
  const reports = [];
  const writes = [];
  const flagChecks = [];
  const save = async (query) => {
    if (failure) throw failure;
    writes.push(query);
    return { ...skill, ...query.data, ...query.create };
  };
  const originalFetch = global.fetch;
  global.fetch = async () => {
    if (failure) throw failure;
    return new Response(markdown);
  };
  t.after(() => { global.fetch = originalFetch; });
  class ProjectAccessError extends Error {}
  const access = { assertProjectAccess: async () => {}, ProjectAccessError };
  const mocks = {
    "@/lib/prisma": { default: {
      aI_Skill: { findFirst: async () => skill, create: save, update: save, upsert: save },
      $transaction: async (queries) => Promise.all(queries),
    } },
    "@/lib/errors/reportError": { reportError: async (report) => reports.push(report) },
    "@/lib/flags": { isFeatureEnabled: async (...args) => {
      flagChecks.push(args);
      if (flagFailure) throw flagFailure;
      return flag;
    } },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ id: 2343 }) },
    "@/app/api/ai/_lib/customInstructions": access,
    "./customInstructions": access,
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
  };
  return {
    invoke: async (operation, input) => {
      const suffix = operation === "update" ? "/[id]" : operation === "import" ? "/import" : "";
      const route = load(`src/app/api/ai/skills${suffix}/route.ts`, mocks);
      const method = operation === "update" ? "PATCH" : "POST";
      return route[method](new NextRequest(`https://app.hypertask.ai/api/ai/skills${suffix}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }), { params: Promise.resolve({ id: "1" }) });
    },
    reports, writes, flagChecks,
  };
}

for (const operation of ["create", "update", "import"]) {
  const valid = operation === "import" ? { url: importUrl, scope: "user" } : { name: "Review", body: "Review changes" };
  const cases = operation === "import" ? [
    [{ url: importUrl, scope: "user" }, "---\nname: Review", "SKILL.md frontmatter is not closed"],
    [{ url: importUrl, scope: "user" }, "---\nname: Review\n---\n", 'Skill "Review" has an empty body'],
    [{ url: importUrl, scope: "user", slugs: [] }, undefined, "Select at least one skill to import"],
  ] : [
    [{ name: " ", body: "Review changes" }, undefined, "Skill name is required"],
    [{ name: "Review", slug: "!!!", body: "Review changes" }, undefined, "Skill slug is required"],
    [{ name: "Review", body: " " }, undefined, "Skill body is required"],
    [{ name: "Review", body: "x".repeat(64 * 1024 + 1) }, undefined, "Skill body exceeds the 64KB limit"],
    [{ markdown: " \n\t " }, undefined, "Skill name is required"],
    [{ markdown: "---\nname: Review" }, undefined, "SKILL.md frontmatter is not closed"],
  ];

  for (const [input, markdown, message] of cases) {
    test(`${operation}: invalid skill returns 400 without reporting: ${message}`, async (t) => {
      const h = harness(t, { markdown });
      const response = await h.invoke(operation, input);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: message });
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.reports, []);
      assert.deepEqual(h.flagChecks, [[flagKey, 2343]]);
    });
  }

  test(`${operation}: a valid skill still succeeds and persists its fields`, async (t) => {
    const h = harness(t);
    const response = await h.invoke(operation, valid);
    assert.equal(response.status, operation === "create" ? 201 : 200);
    const result = await response.json();
    assert.equal((operation === "import" ? result.skills[0] : result.skill).name, "Review");
    assert.equal(h.writes.length, 1);
    const data = h.writes[0].data ?? h.writes[0].create;
    assert.equal(data.name, "Review");
    assert.equal(data.body, "Review changes");
    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.flagChecks, []);
  });

  if (operation !== "import") {
    test(`${operation}: heading-free Markdown still saves with its derived name`, async (t) => {
      const h = harness(t);
      const response = await h.invoke(operation, { markdown: "Review changes" });
      assert.equal(response.status, operation === "create" ? 201 : 200);
      assert.deepEqual((await response.json()).skill, {
        ...skill,
        ...(operation === "create" ? { userId: 2343, projectId: null, enabled: true, createdById: 2343 } : {}),
        name: "Review changes", slug: "review-changes", body: "Review changes",
        description: null, argumentHint: null,
      });
      assert.equal(h.writes.length, 1);
      assert.deepEqual(h.reports, []);
      assert.deepEqual(h.flagChecks, []);
    });
  }

  test(`${operation}: schema validation returns 400 without reporting`, async (t) => {
    const h = harness(t);
    const response = await h.invoke(operation, { ...valid, scope: "invalid", name: 123 });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid|Expected string/);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.reports, []);
  });

  test(`${operation}: flag off retains validation reporting`, async (t) => {
    const [input, markdown, message] = cases[0];
    const h = harness(t, { flag: false, markdown });
    const response = await h.invoke(operation, input);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: message });
    assert.deepEqual(h.writes, []);
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].message, message);
    assert.deepEqual(h.flagChecks, [[flagKey, 2343]]);
  });

  test(`${operation}: a flag lookup failure keeps the 400 and legacy reporting`, async (t) => {
    const [input, markdown, message] = cases[0];
    const h = harness(t, { flagFailure: new Error("Flag lookup unavailable"), markdown });
    const response = await h.invoke(operation, input);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: message });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].message, message);
    assert.deepEqual(h.writes, []);
  });

  test(`${operation}: a generic error with matching text is still reported`, async (t) => {
    const failure = new Error("Skill name is required");
    const h = harness(t, { failure });
    const response = await h.invoke(operation, valid);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: failure.message });
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].message, failure.message);
    assert.equal(h.reports[0].stack, failure.stack);
    assert.equal(h.reports[0].source, "handled");
    assert.deepEqual(h.flagChecks, []);
  });
}

test("the bugfix is enabled for an ordinary user by default and can be switched off", async () => {
  const definition = load("src/lib/flags/definitions/htpr-7781-skill-validation.ts", {}).default;
  const { isFeatureEnabled } = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [definition] },
  });
  const db = { featureFlag: { findUnique: async () => null } };
  assert.equal(await isFeatureEnabled(flagKey, 2343, db), true);
  db.featureFlag.findUnique = async () => ({ mode: "OFF" });
  assert.equal(await isFeatureEnabled(flagKey, 2343, db), false);
});
