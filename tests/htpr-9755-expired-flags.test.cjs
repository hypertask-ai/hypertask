const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { definitions } = require("./helpers/flag-files.cjs");
const { root, loadModule } = require("./helpers/loadModule.cjs");
const keys = ["htpr-6921-slack-marketplace", "htpr-7179-agent-team-bound", "htpr-7306-ctrlj-footer-one-line"];

test("batch 2 retires definitions, production modes, and exactly three stored switches", () => {
  const registry = definitions();
  const snapshot = require("../e2e/smoke/production-flag-modes.json");
  for (const key of keys) {
    assert.equal(registry.some((entry) => entry.key === key || entry.related?.includes(key)), false, key);
    assert.equal(Object.hasOwn(snapshot.modes, key), false, key);
    assert.equal(fs.existsSync(path.join(root, "e2e/smoke/flag-modes", `${key}.json`)), false, key);
  }
  const migration = fs.readFileSync(path.join(root, "src/prisma/migrations/20261128120000_htpr_9755_drop_expired_flags_batch_2/migration.sql"), "utf8");
  assert.equal(migration, keys.map((key) => `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`).join(""));
});

test("owner agent-list response always includes only a boolean team binding indicator", async () => {
  const agents = [null, "private-team"].map((credentialTeamId, i) => ({ id: `agent-${i}`, displayName: "Agent", revokedAt: null, createdAt: new Date("2026-10-23"), visibility: "PRIVATE", members: [], credentialTeamId }));
  const { handleListAgentsRequest } = loadModule("src/lib/mcp/agents/list.ts", {
    "@/lib/prisma": { default: { agent: { findMany: async () => agents } } },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null, validateMcpAuth: async () => ({ user: { id: 6 } }) },
    "@/lib/flags": { isFeatureEnabled: () => assert.fail("agent list must not read flags") },
  });
  const response = await handleListAgentsRequest({ nextUrl: new URL("https://app.hypertask.ai/api/mcp/agents") });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.agents.map(({ team_bound }) => team_bound), [false, true]);
  assert.doesNotMatch(JSON.stringify(body), /private-team|credentialTeam/);
});
