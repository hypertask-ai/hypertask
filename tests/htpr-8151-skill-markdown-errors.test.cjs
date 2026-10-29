const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const validMarkdown = "---\nname: QA review\ndescription: Review changes.\n---\nKeep the evidence.";
const importUrl = "https://raw.githubusercontent.com/example/skills/main/review/SKILL.md";

function harness(kind, { markdown, failure } = {}) {
  const reports = [];
  const writes = [];
  const persist = async ({ data }) => {
    if (failure) throw failure;
    const skill = { id: 17, ...data };
    writes.push(skill);
    return skill;
  };
  const mocks = {
    "@/lib/prisma": { default: {
      aI_Skill: {
        findFirst: async () => ({ id: 17, slug: "qa-review" }),
        create: persist,
        update: persist,
        upsert: ({ create }) => persist({ data: create }),
      },
      $transaction: async promises => Promise.all(promises),
    } },
    "@/lib/errors/reportError": { reportError: async report => reports.push(report) },
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ id: 985 }) },
    "@/app/api/ai/_lib/customInstructions": {
      assertProjectAccess: async () => {},
      ProjectAccessError: class extends Error {},
    },
    "./customInstructions": { assertProjectAccess: async () => {} },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
  };
  const file = kind === "update" ? "[id]/route.ts" : kind === "import" ? "import/route.ts" : "route.ts";
  const route = load(`src/app/api/ai/skills/${file}`, mocks);
  const method = kind === "update" ? "PATCH" : "POST";
  const body = kind === "import" ? { scope: "user", url: importUrl } : { markdown };
  return {
    reports,
    writes,
    send: () => route[method](new NextRequest("https://app.hypertask.ai/api/ai/skills", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "17" }) }),
  };
}

for (const kind of ["create", "update", "import"]) {
  for (const [markdown, message] of [
    ["---\nname: QA review\nBody without closing delimiter", "SKILL.md frontmatter is not closed"],
    ["---\nname: QA review\n---\n", 'Skill "QA review" has an empty body'],
    ["---\nname: !!!\n---\nReview changes.", "Skill name must contain a letter or number"],
  ]) {
    test(`${kind}: malformed Markdown stays a 400 without writes or incidents: ${message}`, async t => {
      t.mock.method(global, "fetch", async () => new Response(markdown));
      const h = harness(kind, { markdown });
      const response = await h.send();
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: message });
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.reports, []);
    });
  }

  test(`${kind}: valid Markdown still saves the parsed content`, async t => {
    t.mock.method(global, "fetch", async () => new Response(validMarkdown));
    const h = harness(kind, { markdown: validMarkdown });
    const response = await h.send();
    assert.equal(response.status, kind === "create" ? 201 : 200);
    const result = await response.json();
    const skill = kind === "import" ? result.skills[0] : result.skill;
    assert.equal(skill.name, "QA review");
    assert.equal(skill.slug, "qa-review");
    assert.equal(skill.body, "Keep the evidence.");
    assert.equal(skill.description, "Review changes.");
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.reports, []);
  });

  for (const message of ["Database unavailable", "SKILL.md frontmatter is not closed"]) {
    test(`${kind}: unexpected errors remain reported, even matching parser text: ${message}`, async t => {
      t.mock.method(global, "fetch", async () => new Response(validMarkdown));
      const failure = new Error(message);
      const h = harness(kind, { markdown: validMarkdown, failure });
      const response = await h.send();
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: message });
      assert.equal(h.reports.length, 1);
      assert.equal(h.reports[0].message, message);
      assert.equal(h.reports[0].stack, failure.stack);
      assert.equal(h.reports[0].source, "handled");
      assert.deepEqual(h.writes, []);
    });
  }
}
