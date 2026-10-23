const { teamFixture, teamScope } = require('./htpr-7179-team.cjs');
function setup(mode, actor) {
  const f = teamFixture(mode, actor);
  Object.assign(f.agent, { credentialTeamId: actor === 'bound' ? 'team-a' : null, credentialTeamAccessBinding: actor === 'bound' ? teamScope.accessBinding : null });
  const team = { id: 'team-a', googleAccount: { id: 'account-a', userId: f.user.id }, managementKeyOwnerGeneration: 0, members: [] };
  f.prisma.team = f.model([team], 'team');
  f.prisma.$transaction = async run => Array.isArray(run) ? Promise.all(run) : run(f.prisma);
  const subscriptions = [15, 25].map(projectId => ({ id: `board-${projectId}`, projectId, teamId: null, project: f.projects.find(p => p.id === projectId), agentId: f.agent.id, active: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), lastDeliveryAt: null, lastDeliveryOk: null, events: [], supportsUnassignedEvent: true, secret: 'fixture', url: 'https://receiver.example.invalid/webhook' }));
  const agentSubscription = { id: 'agent-sub', agentId: f.agent.id, agent: f.agent, projectId: null, project: null, deliveries: [], active: true, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), lastDeliveryAt: null, lastDeliveryOk: null, events: ['task.assigned', 'task.updated', 'chat.message'], secret: 'fixture', url: 'https://receiver.example.invalid/webhook' };
  const boardRows = [];
  const agentRows = [];
  f.prisma.webhookSubscription = f.model(subscriptions, 'subscription');
  f.prisma.agentWebhookSubscription = f.model([agentSubscription], 'agent-subscription');
  f.prisma.boardWebhookDelivery = f.model(boardRows, 'board-delivery');
  f.prisma.agentWebhookDelivery = f.model(agentRows, 'agent-delivery');
  f.prisma.boardWebhookAttempt = f.model([], 'attempt');
  const sent = [];
  const queued = [];
  Object.assign(f.mocks, {
    '@/lib/mcp/webhooks/queue': { queueBoardWebhookDelivery: async id => queued.push(id) },
    '@/lib/agentWebhooks/queue': { queueAgentWebhookDelivery: async id => queued.push(id) },
    '@/lib/mcp/webhooks/delivery': { postSignedWebhook: async input => { sent.push(JSON.parse(input.body)); return { ok: true, statusCode: 200, durationMs: 1 }; } },
  });
  f.mocks['@/lib/agentWebhooks/outbox'] = f.load('src/lib/agentWebhooks/outbox.ts');
  const event = projectId => ({ event: 'task.assigned', data: { task: { id: projectId * 10, projectId, ticketNumber: `T-${projectId}`, title: `${projectId === 15 ? 'A' : 'B'}-title` }, action: 'assigned', assignee: { userId: f.user.id, agentId: f.agent.id }, actor: { userId: f.user.id, agentId: null } } });
  const input = projectId => ({ event: 'task.assigned', agentId: f.agent.id, projectId, taskId: projectId * 10, taskTitle: `${projectId === 15 ? 'A' : 'B'}-title`, ticketNumber: `T-${projectId}`, actor: { userId: f.user.id, displayName: 'Owner' } });
  return { ...f, team, subscriptions, agentSubscription, boardRows, agentRows, sent, queued, event, input };
}

module.exports = { setup };
