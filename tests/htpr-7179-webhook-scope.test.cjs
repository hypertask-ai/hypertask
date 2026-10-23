const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');

const { setup } = require('./helpers/htpr-7179-webhooks.cjs');

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound']) {
    test(`${mode} ${actor}: board and agent webhook eligibility, queued delivery and replay authorize actual live projects`, async () => {
      const f = setup(mode, actor);
      const board = f.load('src/lib/mcp/webhooks/outbox.ts');
      const agent = f.load('src/lib/agentWebhooks/outbox.ts');
      const boardDelivery = f.load('src/lib/mcp/webhooks/outboxDelivery.ts');
      const agentDelivery = f.load('src/lib/agentWebhooks/delivery.ts');
      await f.run(new NextRequest('http://localhost/api/mcp/webhooks'), async () => {
        const a = await board.persistBoardWebhookEvent(f.prisma, 15, f.event(15));
        assert.equal(a.length, 1);
        assert.equal((await board.persistBoardWebhookEvent(f.prisma, 25, f.event(25))).length, actor === 'bound' ? 0 : 1);
        assert.ok(await agent.persistAgentWebhookEvent(f.prisma, f.input(15)));
        assert.equal(Boolean(await agent.persistAgentWebhookEvent(f.prisma, f.input(25))), actor !== 'bound');
        const now = new Date(0);
        for (const projectId of [15, 25]) {
          const bd = { id: `queued-board-${projectId}`, subscriptionId: `board-${projectId}`, subscription: f.subscriptions.find(s => s.projectId === projectId), status: 'pending', attemptCount: 0, processingAt: null, nextAttemptAt: now, event: 'task.assigned', payload: f.event(projectId), payloadBody: JSON.stringify(f.event(projectId)) };
          const ad = { ...bd, id: `queued-agent-${projectId}`, subscriptionId: 'agent-sub', subscription: f.agentSubscription, payload: f.input(projectId) };
          f.boardRows.push(bd); f.agentRows.push(ad);
          const before = f.sent.length;
          const bresult = await boardDelivery.deliverBoardWebhook(bd.id);
          const aresult = await agentDelivery.deliverAgentWebhook(ad.id);
          const allowed = actor !== 'bound' || projectId === 15;
          assert.equal(bresult.status, allowed ? 'delivered' : 'skipped');
          assert.equal(aresult.status, allowed ? 'delivered' : 'skipped');
          assert.equal(f.sent.length - before, allowed ? 2 : 0);
          if (!allowed) {
            assert.equal(bd.status, 'cancelled'); assert.equal(ad.status, 'cancelled');
            assert.equal(bd.attemptCount, 0); assert.equal(ad.attemptCount, 0);
          }
          const replayBoard = await board.retryBoardWebhookDelivery({ deliveryId: bd.id, subscriptionId: bd.subscriptionId, idempotencyKey: `retry-${projectId}` });
          const replayAgent = await agent.replayAgentWebhookDelivery({ deliveryId: ad.id, subscriptionId: ad.subscriptionId });
          assert.equal(Boolean(replayBoard), allowed); assert.equal(Boolean(replayAgent), allowed);
        }
        if (actor === 'bound') {
          const aTask = f.tasks[0];
          aTask.projectId = 25; aTask.project = f.projects[3];
          const stale = f.event(15);
          assert.deepEqual(await board.persistBoardWebhookEvent(f.prisma, 15, stale), []);
          assert.equal(await agent.persistAgentWebhookEvent(f.prisma, f.input(15)), null);
          f.team.managementKeyOwnerGeneration++;
          const check = f.load('src/lib/webhooks/credentialScope.ts');
          assert.equal(await check.webhookCredentialAllows(f.agent.id, f.event(15), { projectId: 15 }), false);
        }
      });
    });

    test(`${mode} ${actor}: agent brief and addressed chat webhook payload contain only permitted derived content`, async () => {
      const f = setup(mode, actor);
      const assignments = [f.tasks[0], f.tasks[3]].map(task => ({ agentId: f.agent.id, assignedAt: new Date('2026-01-01'), id: task.id, task: { ...task, section: 'In Progress' } }));
      f.prisma.assignees = f.model(assignments, 'assignment');
      f.prisma.taskPullRequest = f.model([f.tasks[0], f.tasks[3]].map(task => ({ id: task.id, lifecycle: 'open', task: { ...task, assignees: [{ agentId: f.agent.id, user: f.user }] }, number: task.id, title: `${task.projectId === 15 ? 'A' : 'B'}-PR`, url: `https://example.invalid/pr/${task.id}`, repositoryOwner: 'fixture', repositoryName: 'repo', checkState: 'passing' })), 'pull-request');
      const comments = [f.tasks[0], f.tasks[3]].map(task => ({ id: task.id, agentId: f.agent.id, taskId: task.id, task, commentText: `${task.projectId === 15 ? 'A' : 'B'}-comment`, text: '', createdAt: new Date('2026-01-01') }));
      f.prisma.comment = f.model(comments, 'comment');
      const sessions = [{ id: 'own-chat', agentId: f.agent.id, userId: f.user.id, projectId: null, taskId: null, teamId: null }];
      f.prisma.chatSession = f.model(sessions, 'session');
      const briefModule = f.load('src/lib/agents/chatBrief.ts');
      const delivery = f.load('src/lib/agentWebhooks/delivery.ts');
      await f.run(new NextRequest('http://localhost/api/mcp/webhooks'), async () => {
        const brief = await briefModule.buildAgentChatBrief({ userId: f.user.id, agentId: f.agent.id, db: f.prisma });
        assert.match(JSON.stringify(brief), /A1-sentinel/);
        assert.equal(JSON.stringify(brief).includes('B1-sentinel'), actor !== 'bound');
        assert.equal(JSON.stringify(brief).includes('B-comment'), actor !== 'bound');
        const payload = { event: 'chat.message', projectId: null, taskId: null, chat: { sessionId: 'own-chat', text: 'human-provided text', messageId: 'message' }, agentBrief: brief };
        const row = { id: 'chat', subscriptionId: 'agent-sub', subscription: f.agentSubscription, payload, event: 'chat.message', status: 'pending', attemptCount: 0, processingAt: null, nextAttemptAt: new Date(0) };
        f.agentRows.push(row);
        assert.equal((await delivery.deliverAgentWebhook(row.id)).status, 'delivered');
        assert.equal(f.sent.length, 1);
        assert.equal(JSON.stringify(f.sent[0]).includes('B-comment'), actor !== 'bound');
        row.id = 'old-chat'; row.status = 'pending'; row.processingAt = null;
        row.payload.agentBrief = { ...brief, recentComments: [{ text: 'B-comment', ticket: { title: 'B-title', url: 'https://app.hypertask.ai/detail/project-25/1' } }] };
        assert.equal((await delivery.deliverAgentWebhook(row.id)).status, actor === 'bound' ? 'skipped' : 'delivered');
      });
    });
  }
}

for (const actor of ['bound', 'unbound']) {
  test(`${actor}: retained creating-agent provenance refuses an unresolvable queued board subscription without a retry`, async () => {
    const f = setup('WATCH', actor);
    const subscription = f.subscriptions[0];
    subscription.createdByAgentId = f.agent.id;
    subscription.agentId = null;
    const now = new Date(0);
    const row = { id: 'origin-check', subscriptionId: subscription.id, subscription, payload: f.event(15), event: 'task.assigned', status: 'pending', processingAt: null, nextAttemptAt: now, attemptCount: 0 };
    f.boardRows.push(row);
    const delivery = f.load('src/lib/mcp/webhooks/outboxDelivery.ts');
    await f.run(new NextRequest('http://localhost/api/mcp/webhooks'), async () => {
      assert.equal((await delivery.deliverBoardWebhook(row.id)).status, 'delivered');
      row.status = 'pending'; row.processingAt = null;
      f.prisma.agent.findUnique = async () => null;
      const before = f.sent.length;
      assert.equal((await delivery.deliverBoardWebhook(row.id)).status, 'skipped');
      assert.equal(row.status, 'cancelled');
      assert.equal(f.sent.length, before);
      assert.deepEqual(f.queued, []);
    });
  });
}
