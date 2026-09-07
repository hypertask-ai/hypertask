const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const flagsPath = path.join(root, "src/lib/flags.ts");
let featureEnabled = async () => false;
require.cache[flagsPath] = {
  id: flagsPath,
  filename: flagsPath,
  loaded: true,
  exports: {
    AGENT_CHAT_SKILLS_FLAG: "htpr-6035-agent-chat-skills",
    isFeatureEnabled: (...args) => featureEnabled(...args),
  },
};
const jiti = require("jiti")(path.join(root, "tests/skill-import.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { SkillImportDisabledError, importSkillsFromGitHub } = jiti(
  path.join(root, "src/app/api/ai/_lib/skillImport.ts")
);

function enableImport(t) {
  featureEnabled = async () => true;
  t.after(() => {
    featureEnabled = async () => false;
  });
}

test("checks the feature flag before any GitHub import request", async (t) => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  const checks = [];
  t.after(() => {
    global.fetch = originalFetch;
    featureEnabled = async () => false;
  });
  featureEnabled = async (key, userId) => {
    checks.push({ key, userId });
    return false;
  };
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("GitHub should not be called");
  };

  await assert.rejects(
    importSkillsFromGitHub("https://github.com/example/skills", 42),
    SkillImportDisabledError
  );
  assert.deepEqual(checks, [
    { key: "htpr-6035-agent-chat-skills", userId: 42 },
  ]);
  assert.equal(fetchCalls, 0);
});

test("fails closed before GitHub when the feature flag lookup fails", async (t) => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  let fetchCalls = 0;
  t.after(() => {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
    featureEnabled = async () => false;
  });
  featureEnabled = async () => {
    throw new Error("flag lookup failed");
  };
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("GitHub should not be called");
  };
  console.error = () => undefined;

  await assert.rejects(
    importSkillsFromGitHub("https://github.com/example/skills", 42),
    SkillImportDisabledError
  );
  assert.equal(fetchCalls, 0);
});

test("rejects skill import URLs outside the GitHub allowlist", async (t) => {
  enableImport(t);
  await assert.rejects(
    importSkillsFromGitHub("https://example.com/SKILL.md", 7),
    /Only github\.com and raw\.githubusercontent\.com URLs are allowed/
  );
});

test("rejects imported skill bodies larger than 64KB", async (t) => {
  enableImport(t);
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async () => new Response("x".repeat(64 * 1024 + 1));

  await assert.rejects(
    importSkillsFromGitHub(
      "https://raw.githubusercontent.com/example/skills/main/large/SKILL.md",
      7
    ),
    /exceeds the 64KB body limit/
  );
});

test("rejects repositories containing more than 50 skills", async (t) => {
  enableImport(t);
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async () =>
    Response.json(
      Array.from({ length: 51 }, (_, index) => ({
        name: "SKILL.md",
        path: `skill-${index}/SKILL.md`,
        type: "file",
      }))
    );

  await assert.rejects(
    importSkillsFromGitHub("https://github.com/example/skills", 7),
    /more than 50 skills/
  );
});
