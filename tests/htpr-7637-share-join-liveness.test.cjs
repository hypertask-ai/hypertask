const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function share(overrides = {}) {
  return {
    id: "share-7637",
    projectId: 15,
    userId: 7,
    shareType: "Anyone",
    expired: false,
    expiredAt: null,
    user: { id: 7 },
    ...overrides,
    task: { uniqueIndex: 7637, status: "Normal", ...overrides.task },
  };
}

function harness(row, project = null) {
  const calls = { shares: [], projects: [], additions: [], memberCreates: [] };
  const prisma = {
    user: { findUnique: async () => ({ id: 985 }) },
    taskSharing: {
      findFirst: async (args) => {
        calls.shares.push(args);
        assert.equal(args.include.task.select.status, true);
        return row;
      },
    },
    project: {
      findFirst: async (args) => {
        calls.projects.push(args);
        return project;
      },
    },
    member: {
      create: async (args) => {
        calls.memberCreates.push(args);
        return { id: 88, ...args.data };
      },
    },
  };
  const { default: membersShare } = load("src/utils/controllers/members/share.ts", {
    "@/lib/prisma": { default: prisma },
    "./addExistingUserToProject": {
      addExistingUserToProject: async (...args) => {
        calls.additions.push(args);
        return { ok: true, outcome: "added" };
      },
    },
  });
  return { membersShare, calls };
}

for (const shareType of ["Anyone", "Domain"]) {
  for (const [requirement, overrides] of [
    ["an unexpired link", { expired: true }],
    ["a validity period that has not elapsed", { expiredAt: new Date("2000-01-01T00:00:00Z") }],
    ["a task that is not deleted", { task: { status: "Deleted" } }],
  ]) {
    test(`now refused: ${shareType} membership requires ${requirement}`, async () => {
      const { membersShare, calls } = harness(share({ shareType, ...overrides }), { id: 15 });
      const result = await membersShare(985, "share-7637");
      assert.deepEqual(result, {
        status: 400,
        json: { message: "Did not find sharelink", allowShare: false },
      });
      assert.equal(calls.shares.length, 1);
      assert.deepEqual(calls.shares[0].where, { id: "share-7637" });
      assert.deepEqual(calls.projects, []);
      assert.deepEqual(calls.additions, []);
      assert.deepEqual(calls.memberCreates, []);
    });
  }
}

test("a missing share retains the same refusal without membership writes", async () => {
  const { membersShare, calls } = harness(null);
  assert.deepEqual(await membersShare(985, "share-7637"), {
    status: 400,
    json: { message: "Did not find sharelink", allowShare: false },
  });
  assert.deepEqual(calls.projects, []);
  assert.deepEqual(calls.additions, []);
  assert.deepEqual(calls.memberCreates, []);
});

for (const expiredAt of [null, new Date("2999-01-01T00:00:00Z")]) {
  test(`still allowed: a live Anyone link preserves membership addition (${expiredAt ? "future expiry" : "no expiry"})`, async () => {
    const row = share({ expiredAt });
    const { membersShare, calls } = harness(row);
    assert.deepEqual(await membersShare(985, row.id), {
      status: 200,
      json: { taskShared: row, allowShare: true },
    });
    assert.equal(calls.shares.length, 1);
    assert.deepEqual(calls.additions, [[15, 985, 7]]);
    assert.deepEqual(calls.projects, []);
  });
}

for (const member of [true, false]) {
  test(`still allowed: a live Domain link preserves allowShare for a ${member ? "member" : "non-member"}`, async () => {
    const row = share({ shareType: "Domain" });
    const { membersShare, calls } = harness(row, member ? { id: 15 } : null);
    assert.deepEqual(await membersShare(985, row.id), {
      status: 200,
      json: { taskShared: row, allowShare: member },
    });
    assert.deepEqual(calls.projects, [{
      where: {
        id: 15,
        OR: [
          { members: { some: { userId: 985, agentId: null } } },
          { ownerId: { in: [985] } },
        ],
      },
    }]);
    assert.deepEqual(calls.additions, []);
    assert.deepEqual(calls.memberCreates, []);
  });
}
