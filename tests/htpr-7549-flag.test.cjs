const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const definition = load("src/lib/flags/definitions/htpr-7549-first-task-pointer.ts");
const key = "htpr-7549-first-task-pointer";

const registry = load("src/lib/flags.ts", {
  "@/lib/prisma": { default: {} },
  "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [definition.default] },
  "@/lib/flags/keys": { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG: "htpr-7042-neon-work-avoidance" },
});

test("the ticket-named UI feature keeps the requested Owner-only preview without claiming high risk", () => {
  assert.equal(definition.HTPR_7549_FIRST_TASK_POINTER_FLAG, key);
  assert.equal(definition.default.key, key);
  assert.equal(definition.default.kind, "feature");
  assert.equal(registry.defaultFeatureFlagMode(key), "OWNER_ONLY");
  assert.deepEqual(definition.default.releaseRisk, {
    risk: "new",
    reason: "Adds a first-task compose pointer and updates the seeded board's AI connection instructions; no signup, access, billing or email changes.",
    ownerRequest: {
      quote: "this one goes behind a feature flag that is only on for me at first pls. Don't release to everyone right away.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/7511",
    },
  });
});

test("Owner remains allowed; QA, ordinary users and a guessed Owner email are still refused", async () => {
  for (const [id, email, expected] of [
    [6, "valentin.yeo@gmail.com", true],
    [985, "valentin@hypertask.ai", false],
    [2343, "normal@example.test", false],
    [2343, "valentin.yeo@gmail.com", false],
    [6, "normal@example.test", false],
  ]) {
    const db = {
      featureFlag: { findUnique: async () => null },
      user: { findUnique: async () => ({ id, email }) },
    };
    assert.equal(await registry.isFeatureEnabled(key, id, db), expected, `${id}:${email}`);
    db.featureFlag.findUnique = async () => ({ mode: "OFF" });
    assert.equal(await registry.isFeatureEnabled(key, id, db), false);
  }
});
