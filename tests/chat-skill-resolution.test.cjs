const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const flagsPath = path.join(root, "src/lib/flags.ts");
const prismaPath = path.join(root, "src/lib/prisma.ts");
const projectAccessPath = path.join(root, "src/utils/controllers/projects/getAllIncludes.ts");
const flagChecks = [];
const lookups = [];
const skill = {
  id: 1,
  userId: 42,
  projectId: null,
  slug: "foo",
  name: "Foo reviewer",
  body: "Review this as Foo.",
  enabled: true,
};

require.cache[flagsPath] = {
  id: flagsPath,
  filename: flagsPath,
  loaded: true,
  exports: {
    isFeatureEnabled: async (...args) => {
      flagChecks.push(args);
      assert.fail("Skill resolution must not read a feature flag");
    },
  },
};
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    default: {
      aI_Skill: {
        findMany: async (query) => {
          lookups.push(query);
          return [{ ...skill, userId: query.where.OR[0].userId }];
        },
      },
    },
  },
};
require.cache[projectAccessPath] = {
  id: projectAccessPath,
  filename: projectAccessPath,
  loaded: true,
  exports: { getProjectWhere: (userId) => ({ userId }) },
};

const jiti = require("jiti")(path.join(root, "tests/chat-skill-resolution.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { resolveSkillsForAiRequest } = jiti(
  path.join(root, "src/app/api/ai/_lib/chatSkillResolution.ts")
);

for (const [name, userId, text] of [
  ["Agent Chat", 42, "chat"],
  ["Task Writer", 2343, "rewrite"],
]) {
  test(`resolves installed skills for ${name} without a flag lookup`, async () => {
    const result = await resolveSkillsForAiRequest(
      `/foo ${text}`,
      { userId, projectId: 15 }
    );

    assert.deepEqual(flagChecks, []);
    assert.equal(result.cleanedText, text);
    assert.deepEqual(result.skills, [{ ...skill, userId }]);
    assert.match(result.systemPromptAddition, /Review this as Foo\./);
    assert.match(result.systemPromptAddition, /user-supplied data/);
    assert.deepEqual(lookups.at(-1).where, {
      enabled: true,
      slug: { in: ["foo"] },
      OR: [
        { userId, projectId: null },
        { projectId: 15, userId: null, project: { is: { userId } } },
      ],
    });
  });
}
