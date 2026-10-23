const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture, matches } = require('./helpers/htpr-7179-team.cjs');
const request = path => new NextRequest(`http://localhost/api/mcp/${path}`);

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound', 'human']) {
    test(`${mode} ${actor}: analytics A succeeds, B refuses before task aggregates and identity lookups`, async () => {
      const f = teamFixture(mode, actor);
      let aggregates = 0;
      let agentLookups = 0;
      f.prisma.task.groupBy = async () => { aggregates++; return [{ agentId: f.agent.id, section: 'Todo', _count: { _all: 3 } }]; };
      const findAgents = f.prisma.agent.findMany;
      f.prisma.agent.findMany = async args => { agentLookups++; return findAgents(args); };
      const route = f.load('src/app/api/mcp/agents/analytics/route.ts');
      const a = await route.GET(request('agents/analytics?project_id=15'));
      assert.equal(a.status, 200);
      assert.equal((await a.json()).fleet[0].tasksTotal, 3);
      const before = [aggregates, agentLookups];
      const b = await route.GET(request('agents/analytics?project_id=25'));
      assert.equal(b.status, actor === 'bound' ? 404 : 200);
      if (actor === 'bound') assert.deepEqual([aggregates, agentLookups], before);
      else assert.deepEqual([aggregates, agentLookups], before.map(n => n + 1));
    });

    test(`${mode} ${actor}: changing only B inbox rows leaves bound composition bytes identical`, async () => {
      const f = teamFixture(mode, actor);
      const notification = (task, id) => ({
        id, notification_inviteId: null, userId: f.user.id, agentId: null,
        projectId: task.projectId, project: task.project, taskId: task.id, task,
        status: 'Normal', archivedAt: null, type: 'Mentioned', seen: false,
        fromUserId: 7, fromAgentId: null, returnedFromReminders: false, createdAt: new Date('2026-01-01'),
      });
      const rows = [notification(f.tasks[0], 1)];
      f.tasks.forEach(task => { task.comments = []; task.Reminders = []; });
      f.prisma.notification = f.model(rows, 'notification');
      f.prisma.notification.groupBy = async ({ where }) => rows.filter(row => matches(row, where)).map(row => ({ ...row, _count: { _all: 1 } }));
      const route = f.load('src/lib/mcp/operations/inbox/composition/operation.ts');
      const response = async () => {
        const res = await route.GET(request('inbox/composition?project_id=15'));
        assert.equal(res.status, 200);
        return res.text();
      };
      const before = await response();
      assert.equal(JSON.parse(before).users[0].inboxZeroDefault.totalActive, 1);
      rows.push(notification(f.tasks[3], 2));
      const withB = await response();
      if (actor === 'bound') assert.equal(withB, before);
      else assert.equal(JSON.parse(withB).users[0].inboxZeroDefault.totalActive, 2);
      rows.pop();
      assert.equal(await response(), before);
      rows.push(notification(f.tasks[0], 3));
      assert.notEqual(await response(), before, 'A notifications remain observable');
      const boardAccess = f.load('src/utils/controllers/notifications/boardAccess.ts');
      const stale = { ...notification(f.tasks[3], 4), projectId: 15, project: f.projects[0] };
      assert.equal(matches(stale, boardAccess.notificationBoardAccessWhere(f.user.id, f.state.ctx.agentId, f.state.ctx.teamScope)), actor !== 'bound');
    });
  }
}
