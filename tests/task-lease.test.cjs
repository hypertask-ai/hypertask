const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require('jiti')(
    path.join(root, `tests/task-lease-jiti-entry-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { '@': path.join(root, 'src') },
    }
  );
  return jiti(path.join(root, relativePath));
}

const {
  DEFAULT_LEASE_TTL_SECONDS,
  MAX_LEASE_TTL_SECONDS,
  MIN_LEASE_TTL_SECONDS,
  canManageLease,
  clampLeaseTtlSeconds,
  isLeaseLive,
  isValidLeaseToken,
} = loadTs('src/lib/mcp/tasks/lease.ts');
const {
  AgentMutationLeaseConflictError,
  assertAgentAssignmentChangeAllowed,
} = loadTs('src/lib/mcp/tasks/agentMutationFence.ts');
const {
  hasRequestedTaskStateChange,
  normalizeRequestedTaskMutation,
  requestedTaskStateChanges,
  taskLifecycleTimestampChanges,
} = loadTs('src/lib/mcp/tasks/humanMutationOverride.ts');

test('lease liveness uses an exclusive expiry boundary', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');

  assert.equal(isLeaseLive(new Date(now.getTime() - 1), now), false);
  assert.equal(isLeaseLive(now, now), false);
  assert.equal(isLeaseLive(new Date(now.getTime() + 1), now), true);
});

test('sibling agents cannot manage each other\'s leases, while their human can', () => {
  assert.equal(canManageLease(42, 'agent-a', 42, 'agent-a'), true);
  assert.equal(canManageLease(42, 'agent-a', 42, 'agent-b'), false);
  assert.equal(canManageLease(42, 'agent-a', 42, null), true);
  assert.equal(canManageLease(42, null, 42, null), true);
  assert.equal(canManageLease(42, null, 7, null), false);
});

test('lease instance tokens require UUIDs', () => {
  assert.equal(
    isValidLeaseToken('11111111-1111-4111-8111-111111111111'),
    true,
  );
  assert.equal(isValidLeaseToken('shared-agent-token'), false);
  assert.equal(isValidLeaseToken(null), false);
});

test('TTL values are defaulted and clamped to the supported range', () => {
  assert.equal(clampLeaseTtlSeconds(), DEFAULT_LEASE_TTL_SECONDS);
  assert.equal(clampLeaseTtlSeconds(MIN_LEASE_TTL_SECONDS - 1), MIN_LEASE_TTL_SECONDS);
  assert.equal(clampLeaseTtlSeconds(MAX_LEASE_TTL_SECONDS + 1), MAX_LEASE_TTL_SECONDS);
  assert.equal(clampLeaseTtlSeconds(600), 600);
});

function mutationTx(lease, ownedAgent = true) {
  const readLease = typeof lease === 'function' ? lease : () => lease;
  return {
    $executeRaw: async () => 1,
    $queryRaw: async (strings) => {
      const sql = Array.from(strings).join('');
      if (!sql.includes('FROM "TaskLease"')) return [];
      const currentLease = readLease();
      if (!currentLease || currentLease.expiresAt <= new Date()) return [];
      return [{
        agentId: currentLease.agentId,
        token: currentLease.token ?? null,
        adoptionCount: currentLease.adoptionCount ?? 0,
      }];
    },
    taskLease: {
      deleteMany: async () => ({ count: readLease() ? 1 : 0 }),
    },
    agent: {
      findFirst: async () => (ownedAgent ? { id: 'agent-a' } : null),
    },
  };
}

test('agent writes require a live matching lease in every transaction', async () => {
  await assert.rejects(
    assertAgentAssignmentChangeAllowed(
      mutationTx(null),
      42,
      'agent-a',
      7,
    ),
    AgentMutationLeaseConflictError,
  );

  await assert.rejects(
    assertAgentAssignmentChangeAllowed(
      mutationTx({
        agentId: 'agent-a',
        expiresAt: new Date(Date.now() - 1),
      }),
      42,
      'agent-a',
      7,
    ),
    AgentMutationLeaseConflictError,
  );

  await assert.doesNotReject(
    assertAgentAssignmentChangeAllowed(
      mutationTx({
        agentId: 'agent-a',
        expiresAt: new Date(Date.now() + 60_000),
      }),
      42,
      'agent-a',
      7,
    ),
  );
});

test('agent writes accept tokenized explicit leases without adoption references', async () => {
  await assert.doesNotReject(
    assertAgentAssignmentChangeAllowed(
      mutationTx({
        agentId: 'agent-a',
        token: '11111111-1111-4111-8111-111111111111',
        adoptionCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
      }),
      42,
      'agent-a',
      7,
    ),
  );
});

test('ordinary human writes remain allowed when no lease exists', async () => {
  await assert.doesNotReject(
    assertAgentAssignmentChangeAllowed(mutationTx(null), 42, null, 7),
  );
});

test('the two-key advisory lock executes PostgreSQL integer overloads without deserializing void', async () => {
  const tx = mutationTx(null);
  const executeRaw = tx.$executeRaw;
  let lockSql = '';
  tx.$executeRaw = async (strings, ...values) => {
    const sql = Array.from(strings).join('?');
    if (sql.includes('pg_advisory_xact_lock')) {
      lockSql = sql;
      if (!/CAST\(\? AS integer\).*CAST\(\? AS integer\)/s.test(sql)) {
        throw new Error(
          'function pg_advisory_xact_lock(bigint, bigint) does not exist',
        );
      }
    }
    return executeRaw(strings, ...values);
  };

  await assert.doesNotReject(
    assertAgentAssignmentChangeAllowed(tx, 42, null, 7),
  );
  assert.match(
    lockSql,
    /pg_advisory_xact_lock\(\s*CAST\(\? AS integer\),\s*CAST\(\? AS integer\)\s*\)/s,
  );
});

test('human cancellation between compound agent transactions blocks the stale write', async () => {
  let lease = {
    agentId: 'agent-a',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const tx = mutationTx(() => lease);

  await assert.doesNotReject(
    assertAgentAssignmentChangeAllowed(tx, 42, 'agent-a', 7),
  );
  lease = null;
  await assert.rejects(
    assertAgentAssignmentChangeAllowed(tx, 42, 'agent-a', 7),
    AgentMutationLeaseConflictError,
  );
});

test('only a real human state change qualifies as an agent-lease override', () => {
  const current = {
    id: 42,
    sectionId: 10,
    section: 'Bugs',
    status: 'Archive',
    dueDate: new Date('2026-08-18T12:00:00.000Z'),
    description: '<p>Current body</p>',
  };

  assert.equal(
    hasRequestedTaskStateChange(current, {
      id: 42,
      status: 'Archive',
      updatedAt: new Date(),
      archivedAt: new Date(),
    }),
    false,
  );
  assert.equal(
    hasRequestedTaskStateChange(current, {
      id: 42,
      dueDate: new Date('2026-08-18T12:00:00.000Z'),
    }),
    false,
  );
  assert.equal(
    hasRequestedTaskStateChange(current, { id: 42, sectionId: 11 }),
    true,
  );
  assert.equal(
    hasRequestedTaskStateChange(current, { id: 42, description: '<p>New body</p>' }),
    true,
  );
  assert.equal(
    hasRequestedTaskStateChange(
      { ...current, parentTaskId: null },
      normalizeRequestedTaskMutation({ id: 42, parentTaskId: 42 }),
    ),
    false,
  );
  assert.equal(
    hasRequestedTaskStateChange(
      { ...current, description: '' },
      normalizeRequestedTaskMutation({ id: 42, description: null }),
    ),
    false,
  );
  assert.equal(
    hasRequestedTaskStateChange(
      current,
      normalizeRequestedTaskMutation({ id: 42, description: null }),
    ),
    true,
  );
  assert.equal(
    hasRequestedTaskStateChange(
      { ...current, recurrence: { interval: 1, unit: 'week' } },
      { id: 42, recurrence: { unit: 'week', interval: 1 } },
    ),
    false,
  );
});

test('full human snapshots become patches before waiting on the agent fence', () => {
  const taskAtRequestTime = {
    id: 42,
    title: 'Agent title before request',
    description: '<p>Agent body before request</p>',
    sectionId: 10,
    section: 'Bugs',
    ranking: 'a0',
  };
  const fullSnapshotWithMove = {
    ...taskAtRequestTime,
    sectionId: 11,
    section: 'In Progress',
    ranking: 'b0',
    updatedAt: new Date(),
  };

  assert.deepEqual(
    requestedTaskStateChanges(taskAtRequestTime, fullSnapshotWithMove),
    {
      sectionId: 11,
      section: 'In Progress',
      ranking: 'b0',
    },
  );
});

test('restoring a task clears both terminal lifecycle timestamps', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');

  assert.deepEqual(taskLifecycleTimestampChanges('Normal', now), {
    archivedAt: null,
    deletedAt: null,
  });
  assert.deepEqual(taskLifecycleTimestampChanges('Archive', now), {
    archivedAt: now,
    deletedAt: null,
  });
  assert.deepEqual(taskLifecycleTimestampChanges('Deleted', now), {
    archivedAt: null,
    deletedAt: now,
  });
});

// The fence and the adoption store must come from ONE jiti instance: each
// instance has its own module registry, so a separately loaded adoption module
// would hold a different AsyncLocalStorage and never reach the fence.
function loadTsTogether(relativePaths) {
  const jiti = require('jiti')(
    path.join(root, `tests/task-lease-jiti-entry-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { '@': path.join(root, 'src') },
    }
  );
  return relativePaths.map((relativePath) => jiti(path.join(root, relativePath)));
}

const [adoptionFence, leaseAdoption] = loadTsTogether([
  'src/lib/mcp/tasks/agentMutationFence.ts',
  'src/lib/mcp/tasks/agentMutationLeaseAdoption.ts',
]);
const {
  AgentMutationLeaseMissingError,
  AgentMutationLeaseConflictError: AdoptionLeaseConflictError,
} = adoptionFence;
const assertFencedWriteAllowed = adoptionFence.assertAgentAssignmentChangeAllowed;
const { withAgentMutationLeaseAdoption } = leaseAdoption;

// A transaction mock that can also serve the adoption insert, so the fence's
// implicit claim is exercised end to end rather than by source text.
function adoptingTx({ lease = null, status = 'Normal', ownedAgent = 'agent-a' } = {}) {
  const state = { lease, status };
  return {
    state,
    $executeRaw: async () => 1,
    $queryRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('');
      if (sql.includes('FROM "TaskLease"')) {
        if (!state.lease || state.lease.expiresAt <= new Date()) return [];
        return [{ agentId: state.lease.agentId }];
      }
      if (sql.includes('INSERT INTO "TaskLease"')) {
        if (state.lease && state.lease.expiresAt > new Date()) return [];
        // Columns: taskId, holder, agentId, lease token, reference token, TTL.
        const [taskId, holder, agentId, , , ttlSeconds] = values;
        state.ttlSeconds = ttlSeconds;
        state.lease = {
          agentId,
          holder,
          token: values[3],
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        };
        return [{ taskId }];
      }
      return [];
    },
    task: {
      findUnique: async () => ({ status: state.status }),
    },
    taskLease: {
      deleteMany: async () => {
        state.lease = null;
        return { count: 1 };
      },
    },
    agent: {
      findFirst: async ({ where }) =>
        where.id === ownedAgent ? { id: where.id } : null,
    },
  };
}

test('an opted-in agent request adopts a lease on its first fenced write', async () => {
  const tx = adoptingTx();

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assertFencedWriteAllowed(tx, 42, 'agent-a', 7);
    // The second transaction of the same request passes on the adopted lease,
    // not on a second adoption.
    await assertFencedWriteAllowed(tx, 42, 'agent-a', 7);
  });

  assert.equal(tx.state.lease.agentId, 'agent-a');
  assert.equal(tx.state.lease.holder, 7);
});

test('one request may adopt a lease for each task it legitimately touches', async () => {
  // A compound agent request (a move that also touches a sibling, say) fences
  // more than one task. Adoption is keyed per task, so the second task is not
  // rejected as though a human had cancelled a lease it never had.
  const first = adoptingTx();
  const second = adoptingTx();

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assertFencedWriteAllowed(first, 42, 'agent-a', 7);
    await assertFencedWriteAllowed(second, 43, 'agent-a', 7);
  });

  assert.equal(first.state.lease.agentId, 'agent-a');
  assert.equal(second.state.lease.agentId, 'agent-a');
});

test('a cancellation on one task does not spend the other task\'s adoption', async () => {
  const first = adoptingTx();
  const second = adoptingTx();

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assertFencedWriteAllowed(first, 42, 'agent-a', 7);
    first.state.lease = null; // a human cancelled task 42 mid-request
    await assertFencedWriteAllowed(second, 43, 'agent-a', 7);
    await assert.rejects(
      assertFencedWriteAllowed(first, 42, 'agent-a', 7),
      AgentMutationLeaseMissingError,
    );
  });
});

test('adoption happens once, so a mid-request human cancellation still blocks the write', async () => {
  const tx = adoptingTx();

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assertFencedWriteAllowed(tx, 42, 'agent-a', 7);
    tx.state.lease = null; // cancelAgentMutationLeaseForHumanOverride deletes the row
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
      AgentMutationLeaseMissingError,
    );
  });

  assert.equal(tx.state.lease, null);
});

test('an explicitly claimed lease still spends its adoption, so cancellation blocks the rest of the request', async () => {
  // The worker claimed the lease itself, so the first fenced write passes on
  // the live lease and never needs adoption. If the grant survived, a human
  // cancelling mid-request would just hand the next transaction a fresh lease.
  const tx = adoptingTx({
    lease: {
      agentId: 'agent-a',
      holder: 7,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assertFencedWriteAllowed(tx, 42, 'agent-a', 7);
    tx.state.lease = null; // a human cancelled the claimed lease mid-request
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
      AgentMutationLeaseMissingError,
    );
  });

  assert.equal(tx.state.lease, null);
});

test('a request that never opted in keeps the strict claim-first behaviour', async () => {
  const tx = adoptingTx();

  await assert.rejects(
    assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
    AgentMutationLeaseMissingError,
  );
  assert.equal(tx.state.lease, null);
});

test('adoption is bound to the exact actor the request authenticated', async () => {
  const tx = adoptingTx({ ownedAgent: 'agent-b' });

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-b', 7),
      AgentMutationLeaseMissingError,
    );
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-a', 8),
      AgentMutationLeaseMissingError,
    );
  });
  assert.equal(tx.state.lease, null);
});

test('adoption refuses archived and deleted tasks, like the claim endpoint', async () => {
  const tx = adoptingTx({ status: 'Archive' });

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
      AgentMutationLeaseMissingError,
    );
  });
  assert.equal(tx.state.lease, null);
});

test('adoption never takes a lease another agent already holds', async () => {
  const tx = adoptingTx({
    lease: { agentId: 'agent-b', expiresAt: new Date(Date.now() + 60_000) },
  });

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
      AdoptionLeaseConflictError,
    );
  });
  assert.equal(tx.state.lease.agentId, 'agent-b');
});

test('an unverified agent id cannot adopt a lease', async () => {
  const tx = adoptingTx({ ownedAgent: 'agent-z' });

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assert.rejects(
      assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
      AgentMutationLeaseMissingError,
    );
  });
  assert.equal(tx.state.lease, null);
});

test('human writes are never given an adopted lease', async () => {
  const tx = adoptingTx();

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, async () => {
    await assert.doesNotReject(
      assertFencedWriteAllowed(tx, 42, null, 7),
    );
  });
  assert.equal(tx.state.lease, null);
});

test('an adopted lease uses the shortest TTL, since nothing will release it', async () => {
  const tx = adoptingTx();

  await withAgentMutationLeaseAdoption({ agentId: 'agent-a', userId: 7 }, () =>
    assertFencedWriteAllowed(tx, 42, 'agent-a', 7),
  );

  // Assert the TTL the insert was given, not wall-clock arithmetic: a loaded
  // test run can put seconds between the call and the assertion.
  assert.equal(tx.state.ttlSeconds, MIN_LEASE_TTL_SECONDS);
});
