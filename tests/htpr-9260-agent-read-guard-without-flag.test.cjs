const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const KEY = "htpr-7665-agent-read-role-guard";
const migration = "src/prisma/migrations/20261116140000_drop_htpr_7665_agent_read_role_guard_flag/migration.sql";
const load = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });

function guardWorld() {
  const reads = [];
  const guard = loadModule("src/lib/mcp/agents/readRoleGuard.ts", {
    "@/lib/mcp/agents/scopes": {
      insufficientScopeResponse: (role, needed) => ({
        status: 403,
        body: { code: "insufficient_scope", error: `${role} needs ${needed}` },
      }),
      getAgentRole: async (ctx) => {
        reads.push("agent");
        return ctx.storedRole ?? "read";
      },
      roleMeets: (role, needed) => ["write", "admin"].includes(role),
    },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => {
        reads.push(key);
        throw new Error("the write guard must not read a flag");
      },
    },
    "@/lib/flags/keys": { HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG: KEY },
  });
  return { guard, reads };
}

test("a read agent is refused without the guard reading any flag", async () => {
  const { guard, reads } = guardWorld();
  const response = await guard.requireAgentWriteRole({ agentId: "agent-read", agentRole: "read", user: { id: 7 } });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "insufficient_scope");
  assert.match(response.body.error, /read needs write/);
  assert.deepEqual(reads, [], "no agent query and no flag read");
});

test("a stored read role is refused without the guard reading any flag", async () => {
  const { guard, reads } = guardWorld();
  const response = await guard.requireAgentWriteRole({ agentId: "agent-read", user: { id: 7 }, storedRole: "read" });
  assert.equal(response.status, 403);
  assert.deepEqual(reads, ["agent"]);
});

for (const role of ["write", "admin"]) {
  test(`a carried ${role} role is allowed without the guard reading any flag`, async () => {
    const { guard, reads } = guardWorld();
    assert.equal(await guard.requireAgentWriteRole({ agentId: "agent-write", agentRole: role, user: { id: 7 } }), null);
    assert.deepEqual(reads, []);
  });
}

test("a person without an agent id is allowed without the guard reading any flag", async () => {
  const { guard, reads } = guardWorld();
  assert.equal(await guard.requireAgentWriteRole({ agentId: null, user: { id: 7 } }), null);
  assert.deepEqual(reads, []);
});

test("the agent read guard is permanent and its safety switch is retired", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${KEY}.ts`)), false);
  assert.equal(fs.readFileSync(path.join(root, migration), "utf8"), `DELETE FROM "FeatureFlag" WHERE "key" = '${KEY}';\n`);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(Object.hasOwn(modes.modes, KEY), false);
  const flags = load(path.join(root, "src/lib/flags.ts"));
  assert.equal(flags.HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG, undefined);
  assert.equal(flags.RETIRED_FEATURE_FLAG_KEYS.has(KEY), true);
});
