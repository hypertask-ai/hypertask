const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createJiti } = require('jiti');
const { Prisma } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const flag = 'htpr-7742-agent-chat-all';
let enabled, subscription, heartbeatAt, rows, claims;
const stub = (file, exports) => {
  const id = path.join(root, file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const prisma = {
  $transaction: async (fn) => fn(prisma),
  $queryRaw: async (strings, ...values) => {
    const sql = Prisma.sql(strings, ...values).text;
    if (sql.includes('FROM "Agent"')) return [{ id: 'agent-1', heartbeatAt }];
    assert.match(sql, /WITH pending AS/);
    assert.match(sql, /SET "isDelivered" = true/);
    claims++;
    return rows.filter((row) => !row.isDelivered).map((row) => {
      row.isDelivered = true;
      return { id: row.id, sessionId: row.sessionId, text: row.content, userName: 'Owner' };
    });
  },
  user: { findUnique: async () => ({ displayName: 'Owner' }) },
  agentWebhookSubscription: { findUnique: async () => subscription },
  chatSession: { update: async () => null },
  chatSessionParticipant: { updateMany: async () => ({ count: 1 }) },
  chatMessage: {
    findMany: async () => rows,
    create: async ({ data }) => { const row = { id: 'prompt-1', createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }) => Object.assign(rows.find((row) => row.id === where.id), data),
  },
};
stub('src/utils/controllers/projects/getAllIncludes.ts', { projectContentAccessWhere: () => ({}) });
stub('src/lib/prisma.ts', { default: prisma });
stub('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => ({ userId: 6 }) });
stub('src/lib/agents/chatAccess.ts', {
  sidebarChatProjectId: () => 15,
  ensureChatParticipant: async () => null,
  loadUserAgentChatSession: async () => ({ ok: true, agentId: 'agent-1', session: { id: 'session-1', agent: { runtimeType: 'EXTERNAL', heartbeatAt } } }),
});
stub('src/lib/flags/keys.ts', {});
stub('src/lib/agentRuns/service.ts', { readAgentChatTurn: async () => null });
stub('src/lib/agents/agentChatActivity.ts', { listAgentChatActivity: async () => [] });
stub('src/lib/flags.ts', { isFeatureEnabled: async (key) => key === flag && enabled });
stub('src/lib/agents/chatBrief.ts', { buildAgentChatBrief: async () => null });
stub('src/lib/agents/chatBroadcast.ts', { broadcastChatSession: async () => null });
stub('src/lib/agentWebhooks/outbox.ts', {
  persistAgentRunTriggerWebhooks: async () => subscription?.active && subscription.events.some((event) => ['chat.message', 'run.created'].includes(event)) ? ['delivery-1'] : [],
  publishAgentWebhookDeliveries: async () => null,
});
stub('src/lib/mcp/routeWrapper.ts', {
  wrapMcpRoute: (handler) => handler,
  checkMcpRouteRateLimit: async () => null,
  validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: 'agent-1' }),
});
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true });
const { agentChatDeliveryMode, AGENT_CHAT_HEARTBEAT_MAX_AGE_MS } = load(path.join(root, 'src/lib/agents/chatAvailability.ts'));
const send = load(path.join(root, 'src/app/api/agent-chat/[sessionId]/messages/route.ts'));
const session = load(path.join(root, 'src/app/api/agent-chat/[sessionId]/route.ts'));
const pending = load(path.join(root, 'src/app/api/mcp/chat/pending/route.ts'));
const now = new Date('2026-10-24T12:00:00Z');
for (const [name, sub, fresh, flagOn, expected] of [
  ['chat webhook wins', { active: true, events: ['chat.message'] }, true, true, 'webhook'],
  ['non-chat webhook falls back when on', { active: true, events: ['task.assigned'] }, true, true, 'polling'],
  ['run-only webhook delivery still hands chat to polling', { active: true, events: ['run.created'] }, true, true, 'polling'],
  ['non-chat webhook stays disabled when off', { active: true, events: ['task.assigned'] }, true, false, null],
  ['no webhook fresh polls when on', null, true, true, 'polling'],
  ['no webhook fresh polls when off', null, true, false, 'polling'],
  ['stale stays offline', { active: true, events: ['task.assigned'] }, false, true, null],
  ['no webhook stale stays offline', null, false, true, null],
]) {
  test(name, async () => {
    enabled = flagOn; subscription = sub;
    heartbeatAt = fresh ? new Date() : new Date(0); rows = []; claims = 0;
    assert.equal(agentChatDeliveryMode({ subscription, heartbeatAt: fresh ? now : new Date(now - AGENT_CHAT_HEARTBEAT_MAX_AGE_MS) }, now, enabled), expected);
    const availability = await session.GET(new Request('https://app.hypertask.ai/api/agent-chat/session-1'), { params: Promise.resolve({ sessionId: 'session-1' }) });
    assert.equal(availability.status, 200);
    const status = await availability.json();
    assert.equal(status.deliveryMode, expected);
    assert.equal(status.chatEnabled, expected !== null);
    const response = await send.POST(new Request('https://app.hypertask.ai/api/agent-chat/session-1/messages', {
      method: 'POST', body: JSON.stringify({ text: 'hello' }),
    }), { params: Promise.resolve({ sessionId: 'session-1' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).delivered, expected !== null);
    assert.equal(rows[0].isDelivered, expected !== 'polling');
    const poll = async () => {
      const res = await pending.GET(new Request('https://app.hypertask.ai/api/mcp/chat/pending'));
      assert.equal(res.status, 200); return (await res.json()).messages;
    };
    assert.equal((await poll()).length, expected === 'polling' ? 1 : 0);
    assert.deepEqual(await poll(), []);
    if (expected === 'webhook' || !enabled && sub?.active) assert.equal(claims, 0);
  });
}
