const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(
  path.join(root, 'tests/agent-lease-adoption-internal-jiti-entry.cjs'),
  { interopDefault: true, alias: { '@': path.join(root, 'src') } }
);
function loadTs(relativePath) {
  return jiti(path.join(root, relativePath));
}

const { assertAgentAssignmentChangeAllowed, AgentMutationLeaseConflictError } =
  loadTs('src/lib/mcp/tasks/agentMutationFence.ts');
const { withAgentMutationLeaseAdoption } = loadTs(
  'src/lib/mcp/tasks/agentMutationLeaseAdoption.ts'
);

function leaseStoreTx(store) {
  return {
    $executeRaw: async () => 1,
    $queryRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('');
      if (sql.includes('INSERT INTO "TaskLease"')) {
        if (store.lease && store.lease.expiresAt > new Date()) return [];
        store.lease = {
          agentId: 'agent-a',
          token: values[3],
          adoptionCount: 1,
          expiresAt: new Date(Date.now() + 60_000),
        };
        return [{ taskId: 42 }];
      }
      if (!sql.includes('FROM "TaskLease"')) return [];
      if (!store.lease || store.lease.expiresAt <= new Date()) return [];
      return [{
        agentId: store.lease.agentId,
        token: store.lease.token,
        adoptionCount: store.lease.adoptionCount,
      }];
    },
    task: { findUnique: async () => ({ status: 'Normal' }) },
    taskLease: {
      deleteMany: async () => {
        const count = store.lease ? 1 : 0;
        store.lease = null;
        return { count };
      },
    },
    agent: { findFirst: async () => ({ id: 'agent-a' }) },
  };
}

test('a lease adopted in the request survives into a later internal request', async () => {
  const store = { lease: null };

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assertAgentAssignmentChangeAllowed(leaseStoreTx(store), 42, 'agent-a', 7);
  });

  assert.ok(store.lease, 'adoption must write a real lease row, not just a grant');

  await assertAgentAssignmentChangeAllowed(leaseStoreTx(store), 42, 'agent-a', 7);
});

test('without a materialized lease the internal request is still fenced out', async () => {
  const store = { lease: null };
  await assert.rejects(
    assertAgentAssignmentChangeAllowed(leaseStoreTx(store), 42, 'agent-a', 7),
    AgentMutationLeaseConflictError
  );
});
