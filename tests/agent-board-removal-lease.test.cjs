const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const prisma = jiti(path.join(root, "src/lib/prisma.ts")).default;
const { removeAgentFromBoard } = jiti(
  path.join(root, "src/utils/controllers/agents/boardMembers.ts"),
);

function fakeDatabase(leases, serializationFailures = 0) {
  let deletes = 0;
  let attempts = 0;
  let leaseWhere;
  const tx = {
    project: { findFirst: async () => ({ id: 15, ownerId: 6 }) },
    member: {
      findFirst: async () => ({ id: 44, agent: { userId: 6 } }),
      delete: async () => {
        deletes += 1;
      },
    },
    taskLease: {
      findFirst: async ({ where }) => {
        leaseWhere = where;
        const lease = leases.find(
          (item) =>
            item.agentId === where.agentId &&
            item.projectId === where.task.projectId &&
            item.expiresAt > where.expiresAt.gt,
        );
        return lease ? { task: lease.task } : null;
      },
    },
  };
  prisma.$transaction = async (run, options) => {
    attempts += 1;
    assert.equal(options.isolationLevel, "Serializable");
    if (attempts <= serializationFailures) throw { code: "P2034" };
    return run(tx);
  };
  return {
    deletes: () => deletes,
    attempts: () => attempts,
    leaseWhere: () => leaseWhere,
  };
}

const lease = (projectId, expiresAt) => ({
  agentId: "agent-1",
  projectId,
  expiresAt,
  task: { ticketNumber: "HTPR-5475", uniqueIndex: 5475 },
});

test("board removal stops for a live lease on that board", async () => {
  const state = fakeDatabase([lease(15, new Date(Date.now() + 60_000))]);

  const result = await removeAgentFromBoard(15, "agent-1", 6);

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /working HTPR-5475/);
  assert.deepEqual(state.leaseWhere().task, { projectId: 15 });
  assert.ok(state.leaseWhere().expiresAt.gt instanceof Date);
  assert.equal(state.deletes(), 0);
});

test("expired and other-board leases do not block removal", async () => {
  for (const unrelated of [
    lease(15, new Date(Date.now() - 60_000)),
    lease(16, new Date(Date.now() + 60_000)),
  ]) {
    const state = fakeDatabase([unrelated]);
    assert.deepEqual(await removeAgentFromBoard(15, "agent-1", 6), { ok: true });
    assert.equal(state.deletes(), 1);
  }
});

test("a serialization conflict retries and observes the new lease", async () => {
  const state = fakeDatabase(
    [lease(15, new Date(Date.now() + 60_000))],
    1,
  );

  const result = await removeAgentFromBoard(15, "agent-1", 6);

  assert.equal(state.attempts(), 2);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(state.deletes(), 0);
});
