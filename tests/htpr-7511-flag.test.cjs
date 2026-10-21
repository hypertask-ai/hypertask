const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./helpers/agent-connection.cjs");
const definition = load("src/lib/flags/definitions/htpr-7511-signup-straight-to-board.ts");
const key = "htpr-7511-signup-straight-to-board";

const registry = load("src/lib/flags.ts", {
  "@/lib/prisma": { default: {} },
  "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [definition.default] },
  "@/lib/flags/keys": { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG: "htpr-7042-neon-work-avoidance" },
});

test("the single discoverable feature defaults to Owner only with the approved access risk", () => {
  assert.equal(definition.HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG, key);
  assert.equal(definition.default.key, key);
  assert.equal(definition.default.kind, "feature");
  assert.equal(registry.defaultFeatureFlagMode(key), "OWNER_ONLY");
  assert.deepEqual(definition.default.releaseRisk, {
    risk: "new",
    highRisk: "access",
    reason: "Changes signup/session trust and customer email; also introduces a seven-day paid-plan trial entry point.",
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
