const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const rollout = "htpr-7686-free-plan-limits";
const retired = "htpr-7922-unlimited-free-boards";
const actor = { actorUserId: 985, entryPoint: "test.unlimited-boards" };

function fixture({ planLimits = true, personal = false, tickets = 0 } = {}) {
  const flagKeys = [];
  const effects = [];
  const boards = [1, 2].map((id) => ({ id, ownerId: 985, teamId: personal ? null : "free-team", status: "Normal" }));
  const db = {
    $executeRaw: async () => effects.push("lock"),
    $queryRaw: async () => [],
    task: { count: async () => tickets },
    project: {
      count: async () => boards.filter((board) => board.status === "Normal").length,
      findUniqueOrThrow: async ({ where }) => boards.find((board) => board.id === where.id) ?? boards[0],
      create: async ({ data }) => {
        const board = { id: boards.length + 1, status: "Normal", ...data };
        boards.push(board);
        effects.push("insert");
        return board;
      },
      update: async ({ where, data }) => {
        const board = boards.find((row) => row.id === where.id);
        Object.assign(board, data);
        return board;
      },
    },
  };
  db.$transaction = async (callback) => callback(db);
  const stubs = {
    "@/lib/prisma": { default: db },
    "@/lib/freeTier": { isPaidTeam: async () => false },
    "@/lib/flags": { isFeatureEnabled: async (key) => {
      flagKeys.push(key);
      return key === rollout && planLimits;
    } },
  };
  const policy = load("src/lib/planLimits.ts", stubs);
  const quota = load("src/utils/controllers/projects/boardQuota.ts", { ...stubs, "@/lib/planLimits": policy });
  const constructor = load("src/utils/controllers/projects/createProjectWithStableName.ts", {
    ...stubs,
    "@/lib/planLimits": policy,
    "./boardQuota": quota,
  });
  return { boards, db, effects, flagKeys, policy, quota, constructor };
}

for (const personal of [false, true]) {
  test(`${personal ? "personal" : "team"}: third through twentieth boards persist with no board guard`, async () => {
    const h = fixture({ personal });
    for (let number = 3; number <= 20; number++) {
      const created = await h.constructor.createProjectWithStableName({
        ownerId: 985,
        teamId: personal ? null : "free-team",
        title: `Board ${number}`,
      }, actor);
      const saved = await h.db.project.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(saved.title, `Board ${number}`);
      assert.equal(saved.name, `project-${number}`);
    }
    assert.equal(h.boards.length, 20);
    assert.equal(h.effects.filter((effect) => effect === "insert").length, 18);
    assert.equal(h.effects.includes("lock"), false);
    assert.equal(h.flagKeys.includes(retired), false);
  });
}

test("restoring an archived board no longer needs board room", async () => {
  const h = fixture();
  h.boards.push({ id: 3, ownerId: 985, teamId: "free-team", title: "Archived", status: "Archive" });
  const restored = await h.quota.updateProjectStatus(3, "Normal", actor);
  assert.equal(restored.status, "Normal");
  assert.equal(h.boards.filter((board) => board.status === "Normal").length, 3);
  assert.equal(h.flagKeys.includes(retired), false);
});

test("restoring an archived board still charges its normal tickets", async () => {
  const h = fixture({ tickets: 250 });
  h.boards.push({ id: 3, ownerId: 985, teamId: "free-team", status: "Archive" });
  await assert.rejects(h.quota.updateProjectStatus(3, "Normal", actor), { limit: "tickets" });
  assert.equal(h.boards[2].status, "Archive");
});

test("unlimited boards preserve ticket and attachment refusals", async () => {
  const h = fixture({ tickets: 250 });
  const scope = { kind: "team", teamId: "free-team" };
  await assert.rejects(h.policy.assertTicketRoom(h.db, scope, 1, actor), { code: "PLAN_LIMIT_REACHED", limit: "tickets", max: 250 });
  await assert.rejects(h.policy.assertFileSizeForProject(1, 11 * 1024 * 1024, actor), { code: "PLAN_LIMIT_REACHED", limit: "file_size", max: 10 * 1024 * 1024 });
  await assert.doesNotReject(h.policy.assertFileSizeForProject(1, 10 * 1024 * 1024, actor));
});

test("the legacy three-board boundary stays active when plan limits are off", async () => {
  const h = fixture({ planLimits: false });
  const legacy = load("src/utils/controllers/projects/boardQuota.ts", {
    "@/lib/prisma": { default: { ...h.db, team: { findMany: async () => [] } } },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/planLimits": h.policy,
  });
  assert.equal(await legacy.isBoardLimitReached(985), false);
  h.boards.push({ id: 3, ownerId: 985, status: "Normal" });
  await assert.rejects(legacy.assertBoardQuota(985), { name: "BoardLimitReachedError" });
});

test("Free plan copy shows unlimited boards whenever plan limits are on", () => {
  const copy = load("src/lib/freePlanLimits.ts", {});
  const plans = load("src/lib/subscriptionPlans.ts", {});
  const flags = { planLimits: true, unlimitedTickets: false };
  assert.deepEqual(copy.freePlanLimitCopy(flags).slice(0, 3), ["Unlimited boards", "Up to 250 open tickets", "Up to 10 MB each on tickets and comments"]);
  assert.equal(copy.freePlanLimitCopy({ planLimits: false, unlimitedTickets: false })[0], "Up to 3 boards (archived don't count)");
  const on = plans.subscriptionPlansFor(flags);
  const off = plans.subscriptionPlansFor({ planLimits: false, unlimitedTickets: false });
  assert.deepEqual(on.filter((plan) => plan.id !== "Free"), off.filter((plan) => plan.id !== "Free"));
  assert.deepEqual(on.find((plan) => plan.id === "Free").perks.find((perk) => perk.title === "Boards"), { title: "Boards", amount: "Unlimited boards", unlimited: true });
});
