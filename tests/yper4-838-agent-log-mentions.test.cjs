const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
const { setup } = require('./helpers/comment-routing.cjs');
const mentions = load('src/utils/controllers/comments/processMentions.ts', {
  '@/lib/configs/taskDetail.config': {},
  '../notifications/sendMentionEmail': {},
  '@/lib/prisma': { default: {} },
  '@/utils/controllers/projects/getProjectMembers': {},
  '@/utils/controllers/followers/createFollowerService': {},
  '@/lib/auth/session': {},
});

const html = '<p>Blocked after two tries. <span data-type="mention" data-label="agent-lead" data-id="HT Product Lead">HT Product Lead</span></p>';
const principal = { userId: 6, agentId: 'runner', displayName: 'Runner', source: 'agent' };
const input = { type: 'THOUGHT', text: 'Blocked after two tries. HT Product Lead', link: null, options: null, replyToMessageId: null };

function harness({ failDelivery = false, noAccess = false } = {}) {
  const calls = { deliveries: [], published: [], comments: [], committed: [] };
  const run = {
    id: 'run', agentId: 'runner', taskId: 99, chatSessionId: null, status: 'ACTIVE',
    agent: { user: { id: 6 } },
    task: { id: 99, userId: 6, projectId: 4060, ticketNumber: 'YPER4-838', title: 'Runner loop' },
  };
  const tx = {
    agentRun: { updateMany: async () => ({ count: 1 }) },
    agentRunActivity: {
      create: async ({ data }) => ({ ...data, commentAgentWebhookDeliveryIds: [], options: null }),
      update: async ({ where, data }) => ({ ...calls.pending, ...data, id: where.id }),
    },
  };
  const service = load('src/lib/agentRuns/service.ts', {
    '@/lib/prisma': { default: {
      agentRun: { findFirst: async () => noAccess ? null : run },
      agentRunActivity: { findUnique: async ({ where }) => calls.committed.find((row) => row.id === where.id || row.idempotencyKey === where.runId_idempotencyKey?.idempotencyKey) ?? null },
      $transaction: async (callback) => {
        const row = await callback(tx);
        calls.committed.push(row);
        return row;
      },
    } },
    './persistence': {
      persistAgentRunActivity: async (db, data) => {
        calls.pending = await db.agentRunActivity.create({ data });
        return calls.pending;
      },
    },
    '@/lib/auth/agentScope': { agentScopeEnforced: () => false, recordAgentBoardScopeMiss: () => {} },
    '@/lib/agentWebhooks/outbox': {
      resolveAgentWebhookActor: async () => ({ userId: 6, agentId: 'runner', displayName: 'Runner' }),
      persistAgentRunTriggerWebhooks: async (db, event) => {
        assert.equal(db, tx);
        if (failDelivery) throw new Error('outbox unavailable');
        calls.deliveries.push(event);
        return ['delivery-1'];
      },
      publishAgentWebhookDeliveries: async (ids) => calls.published.push(ids),
    },
    '@/utils/controllers/comments/processMentions': mentions,
    '@/utils/controllers/comments/createCommentService': { createCommentService: async (comment) => calls.comments.push(comment) },
    '@/lib/flags': { isFeatureEnabled: async () => true },
    '@/lib/agentStatus/boardRefresh': { refreshBoardForAgentRun: async () => {} },
    '@/lib/agents/chatBroadcast': {},
    '@/lib/realtime/server': { broadcastTaskComment: async () => {}, broadcast: async () => {}, userChannel: () => 'user' },
    '@/lib/auth/getSessionUser': {},
    '@/lib/mcp/auth': {},
    '@/utils/controllers/projects/getAllIncludes': {},
  });
  return { calls, create: (text = html, key = 'key') => service.createAgentRunActivity(principal, 'run', input, key, new Date('2026-10-27T01:00:00Z'), text) };
}

test('MCP agent mention stays hidden and retains addressed HTML for durable delivery', async () => {
  const { post, calls } = setup();
  const response = await post({ text: html });
  assert.equal(response.body.routedTo, 'log');
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.activities[0][5], html);
});

test('hidden log mention queues addressed agent once, and retry republishes the same delivery', async () => {
  const { create, calls } = harness();
  const first = await create();
  const retry = await create();
  assert.equal(first.activity.type, 'thought');
  assert.equal(retry.duplicate, true);
  assert.equal(calls.committed.length, 1);
  assert.equal(calls.deliveries.length, 1);
  assert.deepEqual(calls.deliveries[0], {
    event: 'comment.mention', agentId: 'lead', projectId: 4060, taskId: 99,
    ticketNumber: 'YPER4-838', taskTitle: 'Runner loop', commentHtml: html,
    actor: { userId: 6, agentId: 'runner', displayName: 'Runner' },
  });
  assert.deepEqual(calls.published, [['delivery-1'], ['delivery-1']]);
  assert.equal(calls.comments.length, 0);
});

test('unmentioned and self-mentioned progress never wakes another agent or posts a human comment', async () => {
  for (const text of [undefined, '<p>Progress only</p>', '<span data-type="mention" data-label="agent-runner">Runner</span>', `<blockquote>${html}</blockquote>`]) {
    const { create, calls } = harness();
    await create(text === undefined ? '' : text);
    assert.equal(calls.deliveries.length, 0);
    assert.equal(calls.comments.length, 0);
  }
});

test('repeated mention spans enqueue only once', async () => {
  const { create, calls } = harness();
  await create(html + html);
  assert.equal(calls.deliveries.length, 1);
});

test('outbox failure prevents the hidden activity committing', async () => {
  const { create, calls } = harness({ failDelivery: true });
  await assert.rejects(create(), /outbox unavailable/);
  assert.equal(calls.committed.length, 0);
  assert.equal(calls.published.length, 0);
});

test('denied source run never writes or delivers', async () => {
  const { create, calls } = harness({ noAccess: true });
  assert.equal(await create(), null);
  assert.equal(calls.committed.length, 0);
  assert.equal(calls.deliveries.length, 0);
});

for (const initial of ['<p>Blocked after two tries. HT Product Lead</p>', html.replace('agent-lead', 'agent-other')]) {
  test('same visible text and key with changed recipients creates the requested delivery', async () => {
    const { create, calls } = harness();
    await create(initial);
    await create(html);
    assert.equal(calls.committed.length, 2);
    assert.equal(calls.deliveries.at(-1).agentId, 'lead');
    assert.notEqual(calls.committed[0].idempotencyKey, calls.committed[1].idempotencyKey);
  });
}
