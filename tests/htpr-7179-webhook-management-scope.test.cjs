const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { setup } = require('./helpers/htpr-7179-webhooks.cjs');
const req = (path, method = 'GET', body) => new NextRequest(`http://localhost/api/mcp/${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound']) {
    for (const action of ['list', 'create', 'test', 'delete']) {
      test(`${mode} ${actor}: board webhook ${action} A allowed and B refused or unchanged`, async () => {
        for (const projectId of [15, 25]) {
          const f = setup(mode, actor);
          const sent = [];
          const extra = {
            '@/lib/mcp/webhooks/ssrfGuard': { assertSafeWebhookTarget: async () => ({ ok: true }), resolveSafeAddresses: async () => ({ ok: true, addresses: [{ address: '203.0.113.1', family: 4 }] }) },
            '@/lib/webhooks/signingKeyStore': { openWebhookSigningKey: () => 'fixture', webhookSigningKeyHint: () => 'fixture', sealWebhookSigningKey: () => 'fixture' },
            undici: { Agent: class { async close() {} }, request: async (_url, input) => { sent.push(JSON.parse(input.body)); return { statusCode: 200, body: { dump: async () => {} } }; } },
          };
          extra['./ssrfGuard'] = extra['@/lib/mcp/webhooks/ssrfGuard'];
          const delivery = f.load('src/lib/mcp/webhooks/delivery.ts', extra);
          const route = f.load('src/lib/mcp/operations/webhooks/operation.ts', extra);
          const testRoute = f.load('src/app/api/mcp/webhooks/[id]/test/route.ts', { ...extra, '@/lib/mcp/webhooks/delivery': delivery });
          const before = f.writes.length;
          const response = action === 'list' ? await route.GET(req(`webhooks?project_id=${projectId}`))
            : action === 'create' ? await route.POST(req('webhooks', 'POST', { project_id: projectId, url: 'https://receiver.example.invalid/webhook', events: ['task.updated'] }))
              : action === 'delete' ? await route.DELETE(req(`webhooks?id=board-${projectId}`, 'DELETE'))
                : await testRoute.POST(req(`webhooks/board-${projectId}/test`, 'POST'), { params: Promise.resolve({ id: `board-${projectId}` }) });
          const allowed = projectId === 15 || actor !== 'bound';
          assert.equal(response.status, allowed ? action === 'create' ? 201 : 200 : 404);
          if (!allowed) { assert.equal(f.writes.length, before); assert.equal(sent.length, 0); }
          if (allowed && action === 'test') { assert.equal((await response.json()).delivered, true); assert.equal(sent.length, 1); }
        }
      });
    }

    for (const action of ['get', 'configure', 'test', 'rotate', 'delete', 'replay']) {
      test(`${mode} ${actor}: agent webhook ${action} checks existing subscription scope and replay resources`, async () => {
        for (const projectId of [15, 25]) {
          const f = setup(mode, actor);
          f.agentSubscription.projectId = projectId;
          f.agentSubscription.project = f.projects.find(p => p.id === projectId);
          f.prisma.$executeRaw = async () => 1;
          f.prisma.agentWebhookSubscription.upsert = async ({ update }) => { f.writes.push('agent-subscription'); Object.assign(f.agentSubscription, update); return f.agentSubscription; };
          const source = { id: 'source', subscriptionId: f.agentSubscription.id, subscription: f.agentSubscription, event: 'task.assigned', payload: f.input(projectId) };
          f.agentRows.push(source);
          const management = f.load('src/lib/agentWebhooks/management.ts', {
            '@/lib/mcp/webhooks/ssrfGuard': { assertSafeWebhookTarget: async () => ({ ok: true }) },
            '@/lib/webhooks/signingKeyStore': { webhookSigningKeyHint: () => 'fixture', sealWebhookSigningKey: () => 'fixture' },
            '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
          });
          const principal = { userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope };
          const input = { userId: f.user.id, agentId: f.agent.id, principal, action, deliveryId: source.id, url: 'https://receiver.example.invalid/webhook' };
          await f.run(req('webhooks'), async () => {
            const before = f.writes.length;
            if (projectId === 25 && actor === 'bound') {
              await assert.rejects(management.manageAgentWebhook(input), error => error.status === 404);
              assert.equal(f.writes.length, before); assert.equal(f.queued.length, 0);
            } else {
              const result = await management.manageAgentWebhook(input);
              assert.equal(result.success, true);
              if (['test', 'replay'].includes(action)) assert.equal(f.queued.length, 1);
            }
          });
        }
      });
    }
  }
}
