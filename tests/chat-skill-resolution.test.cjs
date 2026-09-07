const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const flagsPath = path.join(root, "src/lib/flags.ts");
const skillsPath = path.join(root, "src/app/api/ai/_lib/skills.ts");
let featureEnabled = async () => false;
const flagChecks = [];
const resolutions = [];

require.cache[flagsPath] = {
  id: flagsPath,
  filename: flagsPath,
  loaded: true,
  exports: {
    AGENT_CHAT_SKILLS_FLAG: "htpr-6035-agent-chat-skills",
    isFeatureEnabled: async (key, userId) => {
      flagChecks.push({ key, userId });
      return featureEnabled();
    },
  },
};
require.cache[skillsPath] = {
  id: skillsPath,
  filename: skillsPath,
  loaded: true,
  exports: {
    resolveSkills: async (text, context) => {
      resolutions.push({ text, context });
      return { text, context };
    },
  },
};

const jiti = require("jiti")(path.join(root, "tests/chat-skill-resolution.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { resolveSkillsForAiRequest } = jiti(
  path.join(root, "src/app/api/ai/_lib/chatSkillResolution.ts")
);

test("gates installed skills in Agent Chat but preserves Task Writer", async () => {
  const onFlagError = () => assert.fail("feature flag lookup should not fail");

  featureEnabled = async () => false;
  await resolveSkillsForAiRequest(
    "/foo chat",
    { userId: 42, projectId: 15 },
    "aiChat",
    onFlagError
  );
  assert.deepEqual(flagChecks, [
    { key: "htpr-6035-agent-chat-skills", userId: 42 },
  ]);
  assert.equal(resolutions.at(-1).context.allowInstalledSkills, false);

  featureEnabled = async () => true;
  await resolveSkillsForAiRequest(
    "/foo chat",
    { userId: 42, projectId: 15 },
    "aiChat",
    onFlagError
  );
  assert.equal(resolutions.at(-1).context.allowInstalledSkills, true);

  const checksBeforeTaskWriter = flagChecks.length;
  featureEnabled = async () => {
    throw new Error("Task Writer must not read the Agent Chat flag");
  };
  await resolveSkillsForAiRequest(
    "/foo rewrite",
    { userId: 2343, projectId: 15 },
    "askAi",
    onFlagError
  );
  assert.equal(flagChecks.length, checksBeforeTaskWriter);
  assert.equal(resolutions.at(-1).context.allowInstalledSkills, true);
});

test("fails Agent Chat installed skills closed when the flag lookup fails", async () => {
  const errors = [];
  featureEnabled = async () => {
    throw new Error("flag unavailable");
  };

  await resolveSkillsForAiRequest(
    "/foo chat",
    { userId: 42 },
    "aiChat",
    (error) => errors.push(error)
  );

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /flag unavailable/);
  assert.equal(resolutions.at(-1).context.allowInstalledSkills, false);
});
