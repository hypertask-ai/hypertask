const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture } = require('./helpers/htpr-7179-team.cjs');
const request = (path, method = 'GET', body) => new NextRequest(`http://localhost/api/mcp/${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound']) {
    for (const action of ['claim', 'heartbeat', 'release', 'session']) {
      test(`${mode} ${actor}: task ${action} refuses B before lease/session side effects`, async () => {
        const f = teamFixture(mode, actor);
        let mutations = 0;
        f.prisma.$executeRaw = async strings => { if (String(strings).includes('DELETE FROM')) mutations++; return 1; };
        f.prisma.$queryRaw = async (strings, ...values) => {
          const sql = String(strings);
          if (sql.includes('FROM "Task"')) return [{ id: values[0] }];
          mutations++;
          return [{ taskId: sql.includes('INSERT') ? values[0] : values[1], holder: f.user.id, agentId: f.agent.id, token: null, expiresAt: new Date(), heartbeatAt: new Date() }];
        };
        f.prisma.taskSession = f.model([], 'session');
        const route = f.load(action === 'session' ? 'src/app/api/mcp/tasks/session/route.ts' : `src/app/api/mcp/tasks/lease/${action}/route.ts`);
        for (const taskId of [150, 250]) {
          const before = [mutations, f.writes.length];
          const response = await route.POST(request(`tasks/${action}`, 'POST', { task_id: taskId, session_id: `session-${taskId}` }));
          assert.equal(response.status, taskId === 250 && actor === 'bound' ? 404 : 200);
          if (response.status === 404) assert.deepEqual([mutations, f.writes.length], before);
        }
      });
    }

    for (const action of ['add', 'remove']) {
      test(`${mode} ${actor}: delegated board ${action} authorizes touched and returned boards against the acting credential`, async () => {
        for (const team of ['a', 'b']) {
          const f = teamFixture(mode, actor);
          const initial = team === 'a' ? f.projects[0] : f.projects[3];
          const added = team === 'a' ? f.projects[1] : f.projects[4];
          const target = { id: 'target-agent', userId: f.user.id, members: [{ projectId: initial.id, project: initial }] };
          const tx = { project: f.prisma.project, agent: f.model([target], 'target'), member: {
            findMany: f.prisma.member.findMany,
            createMany: async ({ data }) => { f.writes.push('delegated-add'); return { count: data.length }; },
            deleteMany: async () => { f.writes.push('delegated-remove'); return { count: 1 }; },
          } };
          const service = f.load('src/lib/mcp/agents/updateBoards.ts');
          const boards = f.load('src/utils/controllers/agents/boardMembers.ts');
          await f.run(request('agents/target-agent', 'PATCH'), async () => {
            const write = () => service.updateOwnedAgentBoards({ $transaction: async run => run(tx) }, (id, userId, db) => boards.getAccessibleAgentBoard(id, userId, f.agent.id, f.state.ctx.teamScope, db), f.user.id, { agentId: target.id, addProjectIds: action === 'add' ? [added.id] : [], removeProjectIds: action === 'remove' ? [initial.id] : [] }, f.state.ctx.teamScope?.teamId, f.agent.id);
            if (team === 'b' && actor === 'bound') {
              await assert.rejects(write(), error => error.status === 404 || error.status === 403);
              assert.deepEqual(f.writes, []);
            } else {
              const result = await write();
              assert.equal(result.agentId, target.id);
              assert.equal(action === 'add' ? result.addedProjects : result.removedProjects, 1);
            }
          });
        }
      });
    }

    for (const kind of ['escalate', 'decision']) {
      test(`${mode} ${actor}: ${kind} forwards scope into the actual comment writer and refuses B without writes`, async () => {
        const f = teamFixture(mode, actor);
        const comments = [];
        f.prisma.$queryRaw = async () => [];
        f.prisma.decisionRequest = f.model([], 'decision');
        const route = f.load(kind === 'escalate' ? 'src/app/api/mcp/tasks/escalate/route.ts' : 'src/lib/mcp/operations/decisions/operation.ts', {
          '@/utils/controllers/comments/createCommentService': { createCommentService: async input => { comments.push(input); return { id: 1 }; } },
        });
        for (const taskId of [150, 250]) {
          const before = [comments.length, f.writes.length];
          const body = kind === 'escalate' ? { task_id: taskId, reason: 'Fixture reason' } : { task_id: taskId, question: 'Fixture question?', options: ['One', 'Two'] };
          const response = await route.POST(request(kind, 'POST', body));
          const allowed = taskId === 150 || actor !== 'bound';
          assert.equal(response.status, allowed ? 201 : 404);
          if (allowed) assert.deepEqual(comments.at(-1).teamScope, f.state.ctx.teamScope);
          else assert.deepEqual([comments.length, f.writes.length], before);
        }
      });
    }

    test(`${mode} ${actor}: chat reply replay reauthorizes stored proposal targets`, async () => {
      for (const projectId of [15, 25]) {
        const f = teamFixture(mode, actor);
        const session = { id: 'own-chat', userId: f.user.id, user: f.user, agentId: f.agent.id, agent: f.agent, projectId: null, taskId: null, teamId: null };
        const proposal = { id: 'proposal', targetProjectId: projectId, targetProjectTitle: `${projectId === 15 ? 'A' : 'B'}-proposal-title`, targetSectionTitle: 'Todo', targetSectionId: projectId, ticketTitle: 'Fixture', outcome: 'Fixture', status: 'PENDING', failureMessage: null, taskId: null, task: null };
        const messages = [{ id: 'human', sessionId: session.id, role: 'human', content: 'Question', createdAt: new Date('2026-01-01') }, { id: 'answer', sessionId: session.id, role: 'assistant', content: 'Response', createdAt: new Date('2026-01-01'), replyToMessageId: 'human', isDelivered: true, ticketProposal: proposal }];
        f.prisma.chatSession = f.model([session], 'chat');
        f.prisma.chatMessage = f.model(messages, 'chat-message');
        const route = f.load('src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts', { '@/lib/agents/chatBroadcast': { broadcastChatSession: async () => {} } });
        const response = await route.POST(request('chat/sessions/own-chat/messages', 'POST', { text: 'Response', replyToMessageId: 'human' }), { params: Promise.resolve({ sessionId: session.id }) });
        assert.equal(response.status, actor === 'bound' && projectId === 25 ? 404 : 200);
        if (actor === 'bound' && projectId === 25) assert.doesNotMatch(await response.text(), /B-proposal-title/);
        else assert.equal((await response.json()).duplicate, true);
        assert.deepEqual(f.writes, []);
      }
    });

    test(`${mode} ${actor}: chat pending SQL selects only live-authorized sessions before marking messages delivered`, async () => {
      const f = teamFixture(mode, actor);
      const sessions = [
        { id: 'a', agentId: f.agent.id, userId: f.user.id, projectId: 15, taskId: 150, teamId: 'team-a' },
        { id: 'b', agentId: f.agent.id, userId: f.user.id, projectId: null, taskId: 250, teamId: null },
        { id: 'own', agentId: f.agent.id, userId: f.user.id, projectId: null, taskId: null, teamId: null },
      ].map(session => ({ ...session, agent: f.agent }));
      const messages = sessions.map(session => ({ id: `message-${session.id}`, sessionId: session.id, text: `${session.id}-text`, delivered: false }));
      f.prisma.chatSession = f.model(sessions, 'chat');
      f.prisma.agentWebhookSubscription = { findUnique: async () => null };
      f.prisma.$queryRaw = async (strings, ...values) => {
        if (String(strings).includes('FROM "Agent"')) return [{ id: f.agent.id }];
        const scope = values.find(value => value && typeof value === 'object' && 'sql' in value && /^(?:AND session\.id IN\b|AND FALSE\b|$)/.test(value.sql.trim()));
        assert.ok(scope);
        const selected = messages.filter(message => actor === 'unbound' || scope.values.includes(message.sessionId));
        if (actor === 'bound') assert.ok(!scope.values.includes('b'));
        selected.forEach(message => { message.delivered = true; });
        return selected.map(({ delivered, ...message }) => message);
      };
      const route = f.load('src/app/api/mcp/chat/pending/route.ts');
      const response = await route.GET(request('chat/pending'));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.messages.some(message => message.sessionId === 'a'));
      assert.ok(body.messages.some(message => message.sessionId === 'own'));
      assert.equal(body.messages.some(message => message.sessionId === 'b'), actor !== 'bound');
      assert.equal(messages[1].delivered, actor !== 'bound');
    });

    test(`${mode} ${actor}: room access and pending deliveries omit B rooms and stale B-linked messages`, async () => {
      const f = teamFixture(mode, actor);
      f.agent.archivedAt = null;
      f.mocks['@/lib/flags'] = { isFeatureEnabled: async () => true };
      const rooms = [f.projects[0], f.projects[3]].map(project => ({ id: `room-${project.id}`, projectId: project.id, project, dailyTurnBudget: 10 }));
      const messages = rooms.map(room => ({ id: `message-${room.id}`, roomId: room.id, room, taskId: room.projectId * 10, task: f.tasks.find(task => task.projectId === room.projectId), content: `${room.project.name}-room-text`, createdAt: new Date('2026-01-01'), stoppedAt: null, role: 'human', botTurnDepth: 0 }));
      const stale = { ...messages[1], id: 'stale', roomId: rooms[0].id, room: rooms[0] };
      messages.push(stale);
      const deliveries = messages.map(message => ({ id: message.id, agentId: f.agent.id, agent: f.agent, message, handledAt: null, createdAt: message.createdAt }));
      f.prisma.agentRoom = f.model(rooms, 'room');
      f.prisma.agentRoomMessage = f.model(messages, 'room-message');
      f.prisma.agentRoomDelivery = f.model(deliveries, 'room-delivery');
      const access = f.load('src/lib/agents/roomAccess.ts');
      const pending = f.load('src/app/api/mcp/chat/rooms/pending/route.ts');
      await f.run(request('chat/rooms/pending'), async () => {
        const principal = { userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope };
        assert.ok(await access.loadAgentTokenRoom(rooms[0].id, f.agent.id, principal));
        assert.equal(Boolean(await access.loadAgentTokenRoom(rooms[1].id, f.agent.id, principal)), actor !== 'bound');
        const result = await pending.GET(request('chat/rooms/pending'));
        assert.equal(result.status, 200);
        const body = await result.json();
        assert.ok(body.messages.some(message => message.text === 'A1-room-text'));
        assert.equal(body.messages.some(message => message.text === 'B1-room-text'), actor !== 'bound');
        assert.equal(body.messages.some(message => message.id === 'stale'), actor !== 'bound');
      });
    });
  }
}
