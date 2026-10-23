const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture, matches } = require('./helpers/htpr-7179-team.cjs');
const req = () => new NextRequest('http://localhost/api/mcp/agents/runs');

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound']) {
    test(`${mode} ${actor}: run reads, stops, activities and replay refuse B while A and projectless own runs work`, async () => {
      const f = teamFixture(mode, actor);
      const now = new Date();
      const activities = [150, 250].map(id => ({ id: `activity-${id}`, runId: `run-${id}`, type: 'THOUGHT', text: `${id === 150 ? 'A' : 'B'}-activity`, link: null, options: null, createdAt: now, idempotencyKey: 'fixture', selectedAt: null }));
      const sessions = [{ id: 'own', agentId: f.agent.id, userId: f.user.id, taskId: null, projectId: null, teamId: null }, { id: 'linked-b', agentId: f.agent.id, userId: f.user.id, taskId: 250, projectId: null, teamId: null }];
      const runs = [f.tasks[0], f.tasks[3]].map(task => ({ id: `run-${task.id}`, agentId: f.agent.id, agent: { ...f.agent, user: f.user }, taskId: task.id, task, chatSessionId: null, chatSession: null, status: 'ACTIVE', trigger: 'RUNTIME', createdAt: now, lastActivityAt: now, stoppedById: null, activities: activities.filter(a => a.runId === `run-${task.id}`) }));
      runs.push(...sessions.map(session => ({ ...runs[0], id: `run-${session.id}`, taskId: null, task: null, chatSessionId: session.id, chatSession: session })));
      f.prisma.chatSession = f.model(sessions, 'session');
      f.prisma.agentRun = f.model(runs, 'run');
      f.prisma.agentRunActivity = f.model(activities, 'activity');
      f.prisma.agentRunActivity.findUnique = async ({ where }) => where.runId_idempotencyKey ? activities.find(a => a.runId === where.runId_idempotencyKey.runId && a.idempotencyKey === where.runId_idempotencyKey.idempotencyKey) ?? null : activities.find(a => a.id === where.id) ?? null;
      f.prisma.$queryRaw = async () => [];
      const emitted = [];
      const service = f.load('src/lib/agentRuns/service.ts', {
        '@/lib/agentStatus/boardRefresh': { refreshBoardForAgentRun: async () => {} },
        '@/lib/agents/chatBroadcast': { broadcastChatSession: async () => {} },
        '@/lib/agentWebhooks/outbox': { persistAgentRunStoppedWebhook: async (_tx, input) => { emitted.push(input); return null; }, publishAgentWebhookDeliveries: async () => {} },
        '@/lib/realtime/server': { broadcastTaskComment: async () => {}, broadcast: async () => {}, userChannel: () => 'fixture' },
      });
      const principal = { userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope, displayName: 'Fixture', source: 'agent' };
      await f.run(req(), async () => {
        for (const [id, allowed] of [['run-150', true], ['run-250', actor !== 'bound'], ['run-own', true], ['run-linked-b', actor !== 'bound']]) {
          const before = f.writes.length;
          const run = await service.readAgentRun(principal, id, now);
          assert.equal(Boolean(run), allowed, id);
          const list = await service.listAgentRunActivities(principal, id);
          assert.equal(list !== null, allowed, id);
          if (id === 'run-150' || id === 'run-250') {
            const replay = await service.createAgentRunActivity(principal, id, { type: 'THOUGHT', text: id === 'run-150' ? 'A-activity' : 'B-activity', link: null, options: null }, 'fixture', now);
            assert.equal(Boolean(replay?.duplicate), allowed, id);
          }
          const stopped = await service.stopAgentRun(principal, id, now);
          assert.equal(Boolean(stopped), allowed, id);
          if (!allowed) assert.equal(f.writes.length, before, 'refused run produces no mutations');
        }
        if (actor === 'bound') assert.doesNotMatch(JSON.stringify(emitted), /B1-sentinel|B-activity/);
      });
    });

    test(`${mode} ${actor}: own chat and AI session list/messages/rename/delete check actual task links, not nullable projectId`, async () => {
      const f = teamFixture(mode, actor);
      const sessions = [
        { id: 'a', projectId: 15, taskId: 150, teamId: 'team-a', agentId: f.agent.id, userId: f.user.id },
        { id: 'b', projectId: 25, taskId: 250, teamId: 'team-b', agentId: f.agent.id, userId: f.user.id },
        { id: 'linked-b', projectId: null, taskId: 250, teamId: null, agentId: f.agent.id, userId: f.user.id },
        { id: 'own', projectId: null, taskId: null, teamId: null, agentId: f.agent.id, userId: f.user.id },
      ].map(s => ({ ...s, title: `${s.id}-title`, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), messages: [] }));
      const messages = sessions.map(session => ({ id: `message-${session.id}`, sessionId: session.id, session, content: `${session.id}-body`, role: 'human', createdAt: new Date('2026-01-01'), attachments: [] }));
      f.prisma.$queryRaw = async () => [];
      f.prisma.chatSession = f.model(sessions, 'session');
      f.prisma.chatMessage = f.model(messages, 'message');
      f.prisma.chatMessage.count = async ({ where }) => messages.filter(row => matches(row, where)).length;
      const access = f.load('src/lib/agents/chatAccess.ts');
      const { aiSessionDependencies: deps } = f.load('src/app/api/mcp/ai/sessions/_dependencies.ts', { '@/lib/storage/uploadTaskAttachmentToS3': { deleteTaskAttachmentFromS3: async () => {} } });
      const ctx = f.state.ctx;
      await f.run(req(), async () => {
        const principal = { userId: f.user.id, agentId: f.agent.id, teamScope: ctx.teamScope };
        const listed = await deps.list(ctx, 50, 0);
        assert.deepEqual(listed.sessions.map(s => s.id).sort(), actor === 'bound' ? ['a', 'own'] : ['a', 'b', 'linked-b', 'own']);
        for (const id of ['a', 'b', 'linked-b', 'own']) {
          const allowed = ['a', 'own'].includes(id) || actor !== 'bound';
          const chat = await access.loadAgentTokenChatSession({ sessionId: id, agentId: f.agent.id, principal, select: { title: true } });
          assert.equal(chat.ok, allowed);
          const read = await deps.messages(ctx, id, 50, 0);
          assert.equal(Boolean(read), allowed);
          const before = f.writes.length;
          assert.equal(Boolean(await deps.rename(ctx, id, 'Renamed')), allowed);
          await deps.remove(ctx, id);
          if (!allowed) assert.equal(f.writes.length, before);
        }
      });
    });
  }
}
