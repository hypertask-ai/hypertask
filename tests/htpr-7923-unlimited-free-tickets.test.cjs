const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const rollout = "htpr-7686-free-plan-limits";
const unlimited = "htpr-7923-unlimited-free-tickets";
const actor = { actorUserId: 985, entryPoint: "test.unlimited" };
const scope = { kind: "team", teamId: "free-team" };

function fixture(enabled, target = scope) {
  const queries = [];
  const db = {
    $executeRaw: async () => { queries.push("lock"); },
    task: { count: async () => { queries.push("count"); return 350; } },
    project: {
      count: async () => 2,
      findUniqueOrThrow: async () => ({ teamId: target.kind === "team" ? target.teamId : null, ownerId: 985, status: "Normal" }),
    },
  };
  const policy = load("src/lib/planLimits.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/freeTier": { isPaidTeam: async () => false },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === rollout || (key === unlimited && enabled) },
  });
  return { policy, db, queries };
}

for (const kind of ["team", "personal"]) {
  test(`${kind}: all ticket admission paths allow 350 existing tickets; Off restores refusals`, async () => {
    const target = kind === "team" ? scope : { kind: "personal", ownerId: 985 };
    for (const entryPoint of ["app", "slack", "ai", "mcp"]) {
      const ctx = { ...actor, entryPoint };
      for (const invoke of [
        (h) => h.policy.assertTicketRoom(h.db, target, 500, ctx),
        (h) => h.policy.assertProjectTicketRoom(h.db, 15, 1, ctx),
        (h) => h.policy.assertTaskCountTransition(h.db, { projectId: 20, status: "Archive" }, { projectId: 15, status: "Normal" }, ctx),
      ]) {
        const on = fixture(true, target);
        await assert.doesNotReject(() => invoke(on));
        assert.deepEqual(on.queries, []);
        const off = fixture(false, target);
        await assert.rejects(() => invoke(off), { code: "PLAN_LIMIT_REACHED", limit: "tickets", max: 250 });
      }
    }
  });
}

test("unlimited tickets do not remove board or file limits", async () => {
  const h = fixture(true);
  await assert.rejects(h.policy.assertBoardRoom(h.db, scope, 1, actor), {
    code: "PLAN_LIMIT_REACHED", limit: "boards", max: 2,
  });
  await assert.rejects(h.policy.assertFileSizeForProject(15, 11 * 1024 * 1024, actor), {
    code: "PLAN_LIMIT_REACHED", limit: "file_size", max: 10 * 1024 * 1024,
  });
  await assert.doesNotReject(h.policy.assertFileSizeForProject(15, 10 * 1024 * 1024, actor));
});
