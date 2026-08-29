const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/skill-import.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { importSkillsFromGitHub } = jiti(
  path.join(root, "src/app/api/ai/_lib/skillImport.ts")
);

test("rejects skill import URLs outside the GitHub allowlist", async () => {
  await assert.rejects(
    importSkillsFromGitHub("https://example.com/SKILL.md"),
    /Only github\.com and raw\.githubusercontent\.com URLs are allowed/
  );
});

test("rejects imported skill bodies larger than 64KB", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async () => new Response("x".repeat(64 * 1024 + 1));

  await assert.rejects(
    importSkillsFromGitHub(
      "https://raw.githubusercontent.com/example/skills/main/large/SKILL.md"
    ),
    /exceeds the 64KB body limit/
  );
});

test("rejects repositories containing more than 50 skills", async (t) => {
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
    importSkillsFromGitHub("https://github.com/example/skills"),
    /more than 50 skills/
  );
});
