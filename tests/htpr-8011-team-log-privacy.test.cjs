const assert = require("node:assert/strict");
const test = require("node:test");
const { inspect } = require("node:util");
const { load } = require("./task-route-loader.cjs");

for (const hasCustomer of [true, false]) {
  test(`team listing keeps owned and joined teams without logging customer ids (${hasCustomer})`, async (t) => {
    const owned = [{ id: "owned", stripe_customer_id: hasCustomer ? "cus_owned_canary" : null, title: "Private owned title" }];
    const joined = [{ id: "joined", stripe_customer_id: hasCustomer ? "cus_joined_canary" : null, title: "Private joined title" }];
    const calls = [];
    const log = t.mock.method(console, "log", () => {});
    const getAllTeamsMinimal = load("src/utils/controllers/teams/getAllMinimal.ts", {
      "@/lib/prisma": {
        default: {
          user: { findUnique: async (args) => { calls.push(args); return { accountId: "account-42" }; } },
          team: { findMany: async (args) => { calls.push(args); return owned; } },
          member_Team: { findMany: async (args) => { calls.push(args); return joined.map((team) => ({ team, userId: 42 })); } },
        },
      },
    }).default;

    const response = await getAllTeamsMinimal(42);
    assert.deepEqual(response, { status: 200, json: [...owned, ...joined] });
    assert.deepEqual(calls, [
      { where: { id: 42 } },
      { where: { googleAccountId: "account-42" } },
      { where: { userId: 42 }, include: { team: true } },
    ]);
    const output = log.mock.calls.map(({ arguments: args }) => args);
    assert.doesNotMatch(inspect(output), /cus_|Private owned title|Private joined title/);
    assert.deepEqual(output, [
      ["🚀 ~ getAllTeamsMinimal ~ owned_teams:", [{ teamId: "owned", hasCustomer }]],
      ["🚀 ~ getAllTeamsMinimal ~ participating_teams:", [{ teamId: "joined", hasCustomer }]],
    ]);
  });
}

test("empty team listings keep empty diagnostics and response", async (t) => {
  const log = t.mock.method(console, "log", () => {});
  const getAllTeamsMinimal = load("src/utils/controllers/teams/getAllMinimal.ts", {
    "@/lib/prisma": {
      default: {
        user: { findUnique: async () => ({ accountId: "account-42" }) },
        team: { findMany: async () => [] },
        member_Team: { findMany: async () => [] },
      },
    },
  }).default;
  assert.deepEqual(await getAllTeamsMinimal(42), { status: 200, json: [] });
  assert.deepEqual(log.mock.calls.map(({ arguments: args }) => args), [
    ["🚀 ~ getAllTeamsMinimal ~ owned_teams:", []],
    ["🚀 ~ getAllTeamsMinimal ~ participating_teams:", []],
  ]);
});
