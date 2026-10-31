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

const {
  assertAgentAssignmentChangeAllowed,
  AgentMutationLeaseConflictError,
} = loadTs('src/lib/mcp/tasks/agentMutationFence.ts');
const { withAdoptedAgentMutationLease, withAgentMutationLeaseAdoption } =
  loadTs('src/lib/mcp/tasks/agentMutationLeaseAdoption.ts');

const TASK_ID = 42;
const AGENT = 'agent-a';
const USER = 7;

function leaseStore() {
  const store = { lease: null, now: () => new Date() };
  const live = () => store.lease && store.lease.expiresAt > store.now();

  store.db = {
    $executeRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('');
      if (sql.includes('UPDATE "TaskLease"')) {
        const [referenceToken, taskId, holder, agentId, leaseToken] = values;
        if (
          store.lease &&
          store.lease.taskId === taskId &&
          store.lease.holder === holder &&
          store.lease.agentId === agentId &&
          store.lease.token === leaseToken &&
          store.lease.adoptionRefs.includes(referenceToken) &&
          store.lease.adoptionCount > 0
        ) {
          store.lease.adoptionRefs = store.lease.adoptionRefs.filter(
            (reference) => reference !== referenceToken
          );
          store.lease.adoptionCount -= 1;
          if (store.lease.adoptionCount === 0) {
            store.lease.expiresAt = store.now();
          }
          return 1;
        }
        return 0;
      }
      if (!sql.includes('DELETE FROM "TaskLease"')) return 1;
      const [taskId, holder, agentId, token] = values;
      if (
        store.lease &&
        store.lease.taskId === taskId &&
        store.lease.holder === holder &&
        store.lease.agentId === agentId &&
        store.lease.token === token &&
        store.lease.adoptionCount === 0
      ) {
        store.lease = null;
        return 1;
      }
      return 0;
    },
    $queryRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('');
      if (sql.includes('INSERT INTO "TaskLease"')) {
        if (live()) return [];
        const [, holder, agentId, token, referenceToken, ttlSeconds] = values;
        const replacesExpired = !!store.lease;
        const keptToken =
          sql.includes('"token" = EXCLUDED."token"') || !replacesExpired
            ? token
            : store.lease.token;
        store.lease = {
          taskId: TASK_ID,
          holder,
          agentId,
          token: keptToken,
          adoptionCount: 1,
          adoptionRefs: [referenceToken],
          expiresAt: new Date(store.now().getTime() + ttlSeconds * 1000),
        };
        return [{ taskId: TASK_ID }];
      }
      if (
        sql.includes('UPDATE "TaskLease"') &&
        sql.includes('"adoptionCount" = "adoptionCount" + 1')
      ) {
        const [referenceToken, ttlSeconds, taskId, holder, agentId, token] = values;
        if (
          live() &&
          store.lease.taskId === taskId &&
          store.lease.holder === holder &&
          store.lease.agentId === agentId &&
          store.lease.token === token &&
          store.lease.adoptionRefs.some((reference) =>
            reference.startsWith(`${token}:`)
          ) &&
          store.lease.adoptionCount > 0
        ) {
          store.lease.adoptionCount += 1;
          store.lease.adoptionRefs.push(referenceToken);
          store.lease.expiresAt = new Date(
            Math.max(
              store.lease.expiresAt.getTime(),
              store.now().getTime() + ttlSeconds * 1000
            )
          );
          return [{ taskId: TASK_ID }];
        }
        return [];
      }
      if (!sql.includes('FROM "TaskLease"')) return [];
      return live()
        ? [{
            agentId: store.lease.agentId,
            token: store.lease.token,
            adoptionCount: store.lease.adoptionCount,
          }]
        : [];
    },
    task: { findUnique: async () => ({ status: 'Normal' }) },
    taskLease: {
      deleteMany: async () => {
        const count = store.lease ? 1 : 0;
        store.lease = null;
        return { count };
      },
    },
    agent: { findFirst: async () => ({ id: AGENT }) },
  };
  return store;
}

function explicitlyReclaim(store) {
  store.lease = {
    taskId: TASK_ID,
    holder: USER,
    agentId: AGENT,
    token: null,
    adoptionCount: 0,
    adoptionRefs: [],
    expiresAt: new Date(store.now().getTime() + 60_000),
  };
}

const write = (store) =>
  assertAgentAssignmentChangeAllowed(store.db, TASK_ID, AGENT, USER);

test('an agent tool call with no lease is fenced out without the wrapper', async () => {
  const store = leaseStore();
  await assert.rejects(write(store), AgentMutationLeaseConflictError);
});

test('an agent tool call takes the lease and hands it straight back', async () => {
  const store = leaseStore();

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      assert.ok(store.lease, 'the write must run holding a real lease row');
      assert.equal(store.lease.agentId, AGENT);
      assert.equal(store.lease.holder, USER);
    }
  );

  assert.equal(
    store.lease,
    null,
    'the lease must be released, not left to expire on its own'
  );
});

test('several writes inside one tool call share the lease it took', async () => {
  const store = leaseStore();

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      await write(store);
      await write(store);
    }
  );

  assert.equal(store.lease, null);
});

test('overlapping same-agent tool calls keep the lease until both finish', async () => {
  const store = leaseStore();
  let startSecond;
  let secondJoined;
  let finishSecond;
  const secondMayStart = new Promise((resolve) => {
    startSecond = resolve;
  });
  const secondHasJoined = new Promise((resolve) => {
    secondJoined = resolve;
  });
  const secondMayFinish = new Promise((resolve) => {
    finishSecond = resolve;
  });

  const firstCall = withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      startSecond();
      await secondHasJoined;
    }
  );
  const secondCall = withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await secondMayStart;
      await write(store);
      assert.equal(store.lease?.adoptionCount, 2);
      secondJoined();
      await secondMayFinish;
    }
  );

  await firstCall;
  try {
    assert.ok(
      store.lease,
      'the first hand-back must not remove a lease the second call still holds'
    );
    assert.equal(store.lease.adoptionCount, 1);
  } finally {
    finishSecond();
    await secondCall;
  }

  assert.equal(store.lease, null, 'the final hand-back must release the lease');
});

test('a rolled-back join cannot release the original call\'s reference', async () => {
  const store = leaseStore();
  let firstStarted;
  let finishFirst;
  const firstHasStarted = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const firstMayFinish = new Promise((resolve) => {
    finishFirst = resolve;
  });

  const firstCall = withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      firstStarted();
      await firstMayFinish;
    }
  );

  await firstHasStarted;
  try {
    await assert.rejects(
      withAdoptedAgentMutationLease(
        store.db,
        { agentId: AGENT, userId: USER },
        async () => {
          await write(store);
          assert.equal(store.lease.adoptionCount, 2);

          store.lease.adoptionRefs.pop();
          store.lease.adoptionCount -= 1;
          throw new Error('transaction rolled back');
        }
      ),
      /transaction rolled back/
    );

    assert.ok(store.lease, 'the original call must keep its live lease');
    assert.equal(store.lease.adoptionCount, 1);
    assert.equal(store.lease.adoptionRefs.length, 1);
  } finally {
    finishFirst();
    await firstCall;
  }

  assert.equal(store.lease, null, 'the original call still releases normally');
});

test('a later tool call in a long turn takes its own lease', async () => {
  const store = leaseStore();
  const clock = { value: Date.now() };
  store.now = () => new Date(clock.value);

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    () => write(store)
  );

  clock.value += 10 * 60 * 1000;

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      assert.ok(store.lease, 'the second tool call must hold its own lease');
    }
  );

  assert.equal(store.lease, null);
});

test('a failed write still hands the lease back', async () => {
  const store = leaseStore();

  await assert.rejects(
    withAdoptedAgentMutationLease(
      store.db,
      { agentId: AGENT, userId: USER },
      async () => {
        await write(store);
        throw new Error('tool failed');
      }
    ),
    /tool failed/
  );

  assert.equal(
    store.lease,
    null,
    'a failed tool must not park the ticket until the lease expires'
  );
});

test('the release never touches a lease another holder owns', async () => {
  const store = leaseStore();

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      store.lease = {
        taskId: TASK_ID,
        holder: 99,
        agentId: 'agent-b',
        token: null,
        expiresAt: new Date(store.now().getTime() + 60_000),
      };
    }
  );

  assert.ok(store.lease, "another holder's lease must survive our release");
  assert.equal(store.lease.agentId, 'agent-b');
});

test('HTPR-5656: the release never deletes an explicit claim the same agent took later', async () => {
  const store = leaseStore();
  const clock = { value: Date.now() };
  store.now = () => new Date(clock.value);

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    () => write(store)
  );
  clock.value += 10 * 60 * 1000;

  explicitlyReclaim(store);

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    () => write(store)
  );

  assert.ok(store.lease, 'the explicit worker lease must survive the release');
  assert.equal(store.lease.token, null);
});

test('HTPR-5656: a stale hand-back matches the token, not just holder and agent', async () => {
  const { releaseAdoptedAgentMutationLeases } = loadTs(
    'src/lib/mcp/tasks/agentMutationLeaseAdoption.ts'
  );
  const store = leaseStore();
  const clock = { value: Date.now() };
  store.now = () => new Date(clock.value);

  await withAgentMutationLeaseAdoption({ agentId: AGENT, userId: USER }, async () => {
    await write(store);
    clock.value += 10 * 60 * 1000;
    explicitlyReclaim(store);

    await releaseAdoptedAgentMutationLeases(store.db);
  });

  assert.ok(
    store.lease,
    'the hand-back must not delete the explicit lease that replaced ours'
  );
});

test('HTPR-5656: adopting over an expired lease replaces its token, so the hand-back still matches', async () => {
  const store = leaseStore();
  store.lease = {
    taskId: TASK_ID,
    holder: USER,
    agentId: AGENT,
    token: 'stale-token',
    expiresAt: new Date(store.now().getTime() - 1000),
  };

  await withAdoptedAgentMutationLease(
    store.db,
    { agentId: AGENT, userId: USER },
    async () => {
      await write(store);
      assert.notEqual(
        store.lease?.token,
        'stale-token',
        'adoption must mint a fresh token for the replaced row'
      );
    }
  );

  assert.equal(
    store.lease,
    null,
    'the hand-back must delete the row it just adopted, not leave it parked'
  );
});

test('a human tool call is untouched and never adopts a lease', async () => {
  const store = leaseStore();

  await withAdoptedAgentMutationLease(store.db, {}, async () => {
    await assertAgentAssignmentChangeAllowed(store.db, TASK_ID, null, USER);
  });

  assert.equal(store.lease, null, 'a human call must not create a lease');
});
