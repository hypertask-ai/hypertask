const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createJiti } = require('jiti');
const { Prisma } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
let enabled = true, replies, prompts, contexts, queries, sessions, agents, heartbeatUpdates;
const stub = (file, exports) => {
  const id = path.join(root, file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const authenticate = async (request) => contexts[request.headers.get('authorization')?.replace(/^Bearer /, '')] ?? null;
const prisma = {
  agent: {
    findFirst: async ({ where }) => agents.find((agent) => agent.id === where.id && agent.userId === where.userId && agent.revokedAt === where.revokedAt) ?? null,
    updateMany: async ({ where, data }) => {
      heartbeatUpdates.push({ where, data });
      assert.deepEqual(Object.keys(data), ['heartbeatAt']);
      const agent = agents.find((agent) => agent.id === where.id && agent.userId === where.userId && agent.revokedAt === where.revokedAt && (!agent.heartbeatAt || agent.heartbeatAt <= where.OR[1].heartbeatAt.lte));
      if (!agent) return { count: 0 };
      agent.heartbeatAt = data.heartbeatAt;
      return { count: 1 };
    },
  },
  $transaction: async (fn) => fn(prisma),
  $queryRaw: async (strings, ...values) => {
    const sql = Prisma.sql(strings, ...values);
    queries.push(sql);
    if (sql.text.includes('FROM "Agent"')) return [{ id: sql.values[0] }];
    assert.match(sql.text, /session\."agentId" = \$/);
    assert.match(sql.text, /NOT EXISTS[\s\S]*reply\."replyToMessageId"/);
    assert.doesNotMatch(sql.text, /UPDATE "ChatMessage"/);
    assert.doesNotMatch(sql.text, /AND message\."isDelivered" = false/);
    const ownSessions = sessions.filter((session) => session.agentId === sql.values[0]).map((session) => session.id);
    return prompts.filter((message) => ownSessions.includes(message.sessionId) && !replies.some((reply) => reply.replyToMessageId === message.id))
      .map(({ id, sessionId, content }) => ({ id, sessionId, text: content, userName: 'Owner' }));
  },
  agentWebhookSubscription: { findUnique: async () => ({ active: true, events: ['task.assigned'] }) },
  chatSession: {
    findFirst: async ({ where }) => sessions.find((session) => session.id === where.id) ?? null,
    update: async () => null,
  },
  chatMessage: {
    findMany: async ({ where }) => prompts.filter((message) => message.sessionId === where.sessionId),
    findFirst: async ({ where }) => prompts.find((message) => message.id === where.id && message.sessionId === where.sessionId) ?? null,
    findUnique: async ({ where }) => replies.find((reply) => reply.replyToMessageId === where.replyToMessageId) ?? null,
    create: async ({ data }) => { const reply = { id: 'reply-1', createdAt: new Date(), ...data }; replies.push(reply); return reply; },
  },
};
stub('src/lib/prisma.ts', { default: prisma });
stub('src/lib/mcp/auth.ts', { validateMcpAuth: authenticate, checkMcpRateLimit: async () => null, extractBearerToken: (header) => header?.replace(/^Bearer /, '') });
stub('src/lib/mcp/routeWrapper.ts', { wrapMcpRoute: (fn) => fn, validateMcpRouteAuth: authenticate, checkMcpRouteRateLimit: async () => null });
stub('src/lib/flags.ts', { isFeatureEnabled: async (key) => key === 'htpr-7742-agent-chat-all' && enabled });
stub('src/lib/flags/keys.ts', {});
stub('src/utils/controllers/projects/getAllIncludes.ts', { projectContentAccessWhere: () => ({}), getProjectWhere: () => ({}) });
stub('src/lib/agents/visibility.ts', {});
stub('src/lib/agents/chatBroadcast.ts', { broadcastChatSession: async () => null });
stub('src/lib/agents/agentChatActivity.ts', { listAgentChatActivity: async () => [] });
stub('src/lib/agents/chatActivityFeed.ts', { asksForAgentActivity: () => false });
stub('src/lib/mcp/tasks/services.ts', {});
stub('src/lib/mcp/tasks/agentMutationFence.ts', { TaskTeamScopeError: class TaskTeamScopeError extends Error {} });
stub('src/lib/mcp/agents/scopes.ts', {});
stub('src/lib/aiFeedback/automatic.ts', { queueAiFeedback: () => {}, observeFeedbackTools: (tools) => tools });
stub('src/lib/aiFeedback/enabled.ts', { aiFeedbackEnabled: async () => false });
stub('src/lib/telemetry/mcpSseAnalytics.ts', { recordLegacyMcpRequest: () => {} });
stub('src/lib/mcp/mcpV2.ts', { isMcpV2Enabled: async () => false });
stub('src/lib/mcp-server/listQueryContract.ts', { resolvePortableTools: (tools) => tools });
stub('src/lib/mcp-server/legacy-sse.ts', { isLegacySseRequest: () => false });
stub('src/lib/aiFeedback/clientInfo.ts', { rememberFeedbackClient: () => {} });
stub('src/lib/mcp-server/resource-url.ts', { getMcpRequestOrigin: async () => 'https://app.hypertask.ai' });
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true });
const { agentChatTools } = load(path.join(root, 'src/lib/mcp-server/tools/agent-chat.tool.ts'));
const { chatInboxTool } = load(path.join(root, 'src/lib/mcp-server/tools/chat-inbox.tool.ts'));
const { chatReplyTool } = load(path.join(root, 'src/lib/mcp-server/tools/chat-reply.tool.ts'));
stub('src/lib/mcp-server/tools/index.ts', { MCP_TOOLS: [chatInboxTool, chatReplyTool] });
const { selectMcpTools } = load(path.join(root, 'src/lib/mcp-server/consolidated-tools.ts'));
const { handleStatelessMcpRequest } = load(path.join(root, 'src/lib/mcp-server/stateless-http.ts'));
const { mcpHandler } = load(path.join(root, 'src/lib/mcp-server/handler.ts'));
const pending = load(path.join(root, 'src/app/api/mcp/chat/pending/route.ts'));
const transcript = load(path.join(root, 'src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts'));
test.beforeEach(() => {
  enabled = true; replies = []; queries = []; heartbeatUpdates = [];
  agents = [1, 2].map((id) => ({ id: `agent-${id}`, userId: 6, revokedAt: null, heartbeatAt: null }));
  contexts = { 'token-1': { user: { id: 6 }, agentId: 'agent-1' }, 'token-2': { user: { id: 6 }, agentId: 'agent-2' }, human: { user: { id: 6 }, agentId: null } };
  sessions = [1, 2].map((id) => ({ id: `session-${id}`, agentId: `agent-${id}`, userId: 6, user: { displayName: 'Owner' } }));
  prompts = [1, 2].map((id) => ({ id: `message-${id}`, sessionId: `session-${id}`, role: 'human', content: `hello ${id}`, isDelivered: true, createdAt: new Date() }));
});
async function rpc(method, params, token = 'token-1', consolidated = false, deferred = false) {
  const tools = [...selectMcpTools([], consolidated), ...await agentChatTools(contexts[token])];
  const response = await handleStatelessMcpRequest(new Request('https://app.hypertask.ai/mcp', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), { token, clientId: '6' }, tools, { deferred });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
async function call(name, args, token) { return rpc('tools/call', { name, arguments: args }, token); }
const replyArgs = { session_id: 'session-1', reply_to_message_id: 'message-1', text: 'here' };
test('HTTP initialize and legacy/consolidated/deferred lists expose both tools when on, neither when off', async () => {
  for (const consolidated of [false, true]) for (const deferred of [false, true]) {
    enabled = true;
    const list = await rpc('tools/list', {}, 'token-1', consolidated, deferred);
    for (const name of ['hypertask_chat_inbox', 'hypertask_chat_reply']) assert.ok(list.tools.some((tool) => tool.name === name));
    const init = await rpc('initialize', {}, 'token-1', consolidated, deferred);
    assert.match(init.instructions, /hypertask_chat_inbox/); assert.match(init.instructions, /hypertask_chat_reply/);
    assert.match(init.instructions, /does not run itself/);
    enabled = false;
    assert.equal((await rpc('initialize', {}, 'token-1', consolidated, deferred)).instructions, undefined);
    assert.ok(!(await rpc('tools/list', {}, 'token-1', consolidated, deferred)).tools.some((tool) => tool.name.startsWith('hypertask_chat_')));
  }
});
test('inbox lists only own unanswered chats, includes delivered prompts and does not claim on repeated reads', async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await call('hypertask_chat_inbox', {});
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text).messages, [{ id: 'message-1', sessionId: 'session-1', text: 'hello 1', userName: 'Owner' }]);
  }
  assert.equal(prompts[0].isDelivered, true);
  assert.equal(queries.filter((q) => q.text.includes('WITH pending')).length, 2);
});
test('other agent cannot read or reply to this chat', async () => {
  const res = await transcript.GET(new Request('https://app.hypertask.ai/api/mcp/chat/sessions/session-1/messages', { headers: { authorization: 'Bearer token-2' } }), { params: Promise.resolve({ sessionId: 'session-1' }) });
  assert.equal(res.status, 403);
  const reply = await call('hypertask_chat_reply', replyArgs, 'token-2');
  assert.equal(reply.isError, true); assert.equal(replies.length, 0);
});
test('own agent can read and reply in the same session, retry safely, and clear its inbox', async () => {
  const res = await transcript.GET(new Request('https://app.hypertask.ai/api/mcp/chat/sessions/session-1/messages', { headers: { authorization: 'Bearer token-1' } }), { params: Promise.resolve({ sessionId: 'session-1' }) });
  assert.equal(res.status, 200); assert.equal((await res.json()).messages.length, 1);
  const reply = await call('hypertask_chat_reply', replyArgs);
  assert.equal(reply.isError, undefined); assert.equal(replies.length, 1);
  assert.equal(replies[0].sessionId, 'session-1'); assert.equal(replies[0].authorAgentId, 'agent-1');
  assert.equal(JSON.parse((await call('hypertask_chat_reply', replyArgs)).content[0].text).duplicate, true);
  assert.equal(replies.length, 1);
  assert.deepEqual(JSON.parse((await call('hypertask_chat_inbox', {})).content[0].text).messages, []);
});
test('own agent cannot reply to a message from another session', async () => {
  const result = await call('hypertask_chat_reply', { ...replyArgs, reply_to_message_id: 'message-2' });
  assert.equal(result.isError, true); assert.equal(replies.length, 0);
});
test('own agent still can reply to its own message', async () => {
  assert.equal((await call('hypertask_chat_reply', replyArgs)).isError, undefined);
  assert.equal(replies.length, 1);
});
test('human credentials cannot use agent inbox or reply; agent credentials still work', async () => {
  assert.equal((await call('hypertask_chat_inbox', {}, 'human')).isError, true);
  assert.equal((await call('hypertask_chat_reply', replyArgs, 'human')).isError, true);
  assert.equal((await call('hypertask_chat_inbox', {}, 'token-1')).isError, undefined);
});
test('unanswered API is disabled with flag off and allowed with flag on', async () => {
  const req = () => new Request('https://app.hypertask.ai/api/mcp/chat/pending?unanswered=true', { headers: { authorization: 'Bearer token-1' } });
  enabled = false; assert.equal((await pending.GET(req())).status, 404); assert.equal(queries.length, 0);
  enabled = true; assert.equal((await pending.GET(req())).status, 200);
});
test('legacy SSE uses the same flagged catalog and initialize instructions; management stays excluded', async () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/mcp-server/legacy-sse.ts'), 'utf8');
  assert.match(source, /new McpServer\(MCP_SERVER_INFO, \{ instructions: agentChatInstructions\(initialTools\) \}\)/);
  assert.match(source, /await agentChatTools\(ctx\)/);
  const handler = fs.readFileSync(path.join(root, 'src/lib/mcp-server/handler.ts'), 'utf8');
  assert.match(handler, /\.\.\.await agentChatTools\(ctx\)/);
  assert.deepEqual(await agentChatTools({ ...contexts['token-1'], management: {} }), []);
});

test('actual MCP handler advertises chat tools and connect guidance behind the ticket flag', async () => {
  const request = (method) => new Request('https://app.hypertask.ai/mcp', {
    method: 'POST', headers: { authorization: 'Bearer token-1' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
  });
  for (const on of [false, true]) {
    enabled = on;
    const list = await (await mcpHandler(request('tools/list'))).json();
    assert.equal(list.result.tools.some((tool) => tool.name === 'hypertask_chat_inbox'), on);
    assert.equal(list.result.tools.some((tool) => tool.name === 'hypertask_chat_reply'), on);
    assert.equal(list.result.tools.filter((tool) => tool.name.startsWith('hypertask_chat_')).length, on ? 2 : 0);
    const init = await (await mcpHandler(request('initialize'))).json();
    assert.equal(typeof init.result.instructions === 'string', on);
  }
});

test('MCP inbox refreshes only the ordinary caller and throttles repeated checks without claiming messages', async () => {
  const { agentChatDeliveryMode } = load(path.join(root, 'src/lib/agents/chatAvailability.ts'));
  const before = Date.now();
  assert.equal((await call('hypertask_chat_inbox', {})).isError, undefined);
  const first = agents[0].heartbeatAt;
  assert.ok(first.getTime() >= before);
  assert.equal(agents[1].heartbeatAt, null);
  assert.equal(heartbeatUpdates.length, 1);
  assert.equal(agentChatDeliveryMode({ heartbeatAt: first, subscription: { active: true, events: ['run.created'] } }, new Date(), true), 'polling');
  assert.equal((await call('hypertask_chat_inbox', {})).isError, undefined);
  assert.equal(heartbeatUpdates.length, 1);
  assert.equal(agents[0].heartbeatAt, first);
  assert.equal((await call('hypertask_chat_inbox', {}, 'token-2')).isError, undefined);
  assert.equal(agents[0].heartbeatAt, first);
  assert.ok(agents[1].heartbeatAt instanceof Date);
  assert.equal(heartbeatUpdates[1].where.id, 'agent-2');
});
test('inbox API refuses missing auth, human credentials and flag off without moving any heartbeat; own agent still allowed', async () => {
  const req = (token) => new Request('https://app.hypertask.ai/api/mcp/chat/pending?unanswered=true', { headers: token ? { authorization: `Bearer ${token}` } : {} });
  for (const [token, status] of [[null, 401], ['invalid', 401], ['human', 403]]) {
    assert.equal((await pending.GET(req(token))).status, status);
    assert.equal(heartbeatUpdates.length, 0);
  }
  enabled = false;
  assert.equal((await pending.GET(req('token-1'))).status, 404);
  assert.equal(heartbeatUpdates.length, 0);
  enabled = true;
  assert.equal((await pending.GET(req('token-1'))).status, 200);
  assert.equal(heartbeatUpdates.length, 1);
});
test('MCP inbox updates stale heartbeat but refuses revoked caller without refreshing another agent', async () => {
  agents[0].heartbeatAt = new Date(0);
  assert.equal((await call('hypertask_chat_inbox', {})).isError, undefined);
  assert.ok(agents[0].heartbeatAt.getTime() > 0);
  agents[0].revokedAt = new Date();
  const first = agents[0].heartbeatAt;
  assert.equal((await call('hypertask_chat_inbox', {})).isError, true);
  assert.equal(agents[0].heartbeatAt, first);
  assert.equal(agents[1].heartbeatAt, null);
  assert.equal(heartbeatUpdates.length, 1);
});

test('both chat tools belong to the frozen canonical parity registry', async () => {
  const { collectMcpRegistryVariables } = await import('../scripts/parity-ai-chat-inventory.mjs');
  const registry = collectMcpRegistryVariables(require('typescript'), fs.readFileSync(path.join(root, 'src/lib/mcp-server/tools/index.ts'), 'utf8'));
  for (const [variable, importedFrom] of [['chatInboxTool', './chat-inbox.tool'], ['chatReplyTool', './chat-reply.tool']]) {
    assert.deepEqual(registry.find((entry) => entry.variable === variable), { variable, importedFrom });
  }
});

test('actual MCP handler hides canonical chat tools from management and when the flag is off', async () => {
  contexts.management = { ...contexts['token-1'], management: { permissions: { management: ['read'] } } };
  const request = (token) => new Request('https://app.hypertask.ai/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  for (const [token, on, expected] of [['token-1', true, 2], ['management', true, 0], ['token-1', false, 0], ['token-1', true, 2]]) {
    enabled = on;
    const list = await (await mcpHandler(request(token))).json();
    assert.equal(list.result.tools.filter((tool) => tool.name.startsWith('hypertask_chat_')).length, expected);
  }
});
