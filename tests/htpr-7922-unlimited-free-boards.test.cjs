const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const rollout = "htpr-7686-free-plan-limits";
const unlimited = "htpr-7922-unlimited-free-boards";
const actor = { actorUserId: 985, entryPoint: "test.unlimited-boards" };

function fixture({ enabled = true, planLimits = true, personal = false } = {}) {
  const boards = [1, 2].map((id) => ({ id, ownerId: 985, teamId: personal ? null : "free-team", status: "Normal" }));
  const effects = [];
  const db = {
    $executeRaw: async () => effects.push("lock"),
    $queryRaw: async () => [],
    task: { count: async () => 250 },
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
    "@/lib/flags": { isFeatureEnabled: async (key) => (key === rollout && planLimits) || (key === unlimited && enabled) },
  };
  const policy = load("src/lib/planLimits.ts", stubs);
  const quota = load("src/utils/controllers/projects/boardQuota.ts", { ...stubs, "@/lib/planLimits": policy });
  const constructor = load("src/utils/controllers/projects/createProjectWithStableName.ts", {
    ...stubs,
    "@/lib/planLimits": policy,
    "./boardQuota": quota,
  });
  return { boards, db, effects, policy, quota, constructor, setUnlimited: (value) => { enabled = value; } };
}

for (const personal of [false, true]) {
  test(`${personal ? "personal" : "team"}: third through twentieth boards persist; Off refuses without removing existing boards`, async () => {
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
    const off = fixture({ enabled: false, personal });
    await assert.rejects(off.constructor.createProjectWithStableName({ ownerId: 985, teamId: personal ? null : "free-team", title: "Refused" }, actor), {
      code: "PLAN_LIMIT_REACHED", limit: "boards", max: 2,
    });
    assert.equal(off.boards.length, 2);
    assert.equal(off.effects.includes("insert"), false);
    h.setUnlimited(false);
    await assert.rejects(h.constructor.createProjectWithStableName({ ownerId: 985, teamId: personal ? null : "free-team", title: "Board 21" }, actor), { limit: "boards" });
    assert.equal(h.boards.length, 20);
  });
}

test("restoring an empty archived board bypasses only board admission", async () => {
  const h = fixture();
  h.db.task.count = async () => 0;
  h.boards.push({ id: 3, ownerId: 985, teamId: "free-team", title: "Archived", status: "Archive" });
  const restored = await h.quota.updateProjectStatus(3, "Normal", actor);
  assert.equal(restored.status, "Normal");
  assert.equal(h.boards.filter((board) => board.status === "Normal").length, 3);
  const off = fixture({ enabled: false });
  off.boards.push({ id: 3, ownerId: 985, teamId: "free-team", status: "Archive" });
  await assert.rejects(off.quota.updateProjectStatus(3, "Normal", actor), { limit: "boards" });
  assert.equal(off.boards[2].status, "Archive");
});

test("unlimited boards preserve ticket and attachment refusals", async () => {
  const h = fixture();
  const scope = { kind: "team", teamId: "free-team" };
  await assert.rejects(h.policy.assertTicketRoom(h.db, scope, 1, actor), { code: "PLAN_LIMIT_REACHED", limit: "tickets", max: 250 });
  await assert.rejects(h.policy.assertFileSizeForProject(1, 11 * 1024 * 1024, actor), { code: "PLAN_LIMIT_REACHED", limit: "file_size", max: 10 * 1024 * 1024 });
  await assert.doesNotReject(h.policy.assertFileSizeForProject(1, 10 * 1024 * 1024, actor));
});

test("unlimited switch alone leaves the legacy three-board boundary active", async () => {
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

test("Free plan copy matches admission without changing other limits or paid plans", () => {
  const copy = load("src/lib/freePlanLimits.ts", {});
  const plans = load("src/lib/subscriptionPlans.ts", {});
  const flags = { planLimits: true, unlimitedTickets: false, unlimitedBoards: true };
  assert.deepEqual(copy.freePlanLimitCopy(flags).slice(0, 3), ["Unlimited boards", "Up to 250 open tickets", "Up to 10 MB each on tickets and comments"]);
  assert.equal(copy.freePlanLimitCopy({ ...flags, unlimitedBoards: false })[0], "Up to 2 boards (archived don't count)");
  assert.equal(copy.freePlanLimitCopy({ ...flags, planLimits: false })[0], "Up to 3 boards (archived don't count)");
  const on = plans.subscriptionPlansFor(flags);
  const off = plans.subscriptionPlansFor({ ...flags, unlimitedBoards: false });
  assert.deepEqual(on.filter((plan) => plan.id !== "Free"), off.filter((plan) => plan.id !== "Free"));
  assert.deepEqual(on.find((plan) => plan.id === "Free").perks.find((perk) => perk.title === "Boards"), { title: "Boards", amount: "Unlimited boards", unlimited: true });
});

test("the flag defaults to Owner + QA and identifies the plan risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7922-unlimited-free-boards.ts", {}).default;
  assert.equal(definition.key, unlimited);
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
});
