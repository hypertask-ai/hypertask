const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture, teamScope } = require('./helpers/htpr-7179-team.cjs');
const req = (path, method = 'GET', body) => new NextRequest(`http://localhost/api/${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound']) {
    test(`${mode} ${actor}: runtime heartbeat stores A but not B queue, source-section or processed-task metadata`, async () => {
      const f = teamFixture(mode, actor);
      f.state.ctx.agentRuntimeGeneration = 1;
      f.agent.heartbeatAt = null;
      f.tasks.forEach(task => { task.archivedAt = null; task.deletedAt = null; });
      const snapshots = [];
      const route = f.load('src/app/api/mcp/agents/runtime-heartbeat/route.ts', { '@/lib/agents/runtimeState': { saveAgentRuntimeSnapshot: async (_agent, _generation, snapshot) => { snapshots.push(snapshot); return { status: 'saved' }; } } });
      const tasks = [f.tasks[0], f.tasks[3]];
      const body = { sequence: 1, queue: tasks.map(task => ({ board_id: task.projectId, ticket: task.ticketNumber })), source_sections: tasks.map(task => ({ board_id: task.projectId, section: 'Todo' })), processed_tickets: tasks.map(task => ({ board_id: task.projectId, ticket: task.ticketNumber })) };
      const response = await route.POST(req('mcp/agents/runtime-heartbeat', 'POST', body));
      assert.equal(response.status, 200); assert.equal(snapshots.length, 1);
      assert.match(JSON.stringify(snapshots), /A1-sentinel/);
      assert.equal(JSON.stringify(snapshots).includes('B1-sentinel'), actor !== 'bound');
      assert.equal(snapshots[0].sourceSections.some(row => row.boardId === 25), actor !== 'bound');
      assert.equal(snapshots[0].processedTickets.some(row => row.boardId === 25), actor !== 'bound');
    });

    test(`${mode} ${actor}: time status and report totals are scoped at their inner task/entry queries`, async () => {
      const f = teamFixture(mode, actor);
      f.projects.forEach(project => { project.timeTrackingEnabled = true; });
      const entries = [f.tasks[0], f.tasks[3]].map(task => ({ id: task.id, taskId: task.id, task, userId: f.user.id, user: f.user, note: task.title, startedAt: new Date('2026-01-01T00:00:00Z'), endedAt: new Date('2026-01-01T00:01:00Z'), pausedAt: null, createdAt: new Date('2026-01-01') }));
      f.prisma.timeEntry = f.model(entries, 'time');
      const time = f.load('src/lib/timeTracking.ts');
      await f.run(req('mcp/time/status'), async () => {
        assert.equal((await time.taskSummary(f.user.id, 150, f.agent.id, f.state.ctx.teamScope)).myTotalSeconds, 60);
        if (actor === 'bound') await assert.rejects(time.taskSummary(f.user.id, 250, f.agent.id, f.state.ctx.teamScope), time.TimeTrackingDisabledError);
        else assert.equal((await time.taskSummary(f.user.id, 250, f.agent.id, null)).taskTotalSeconds, 60);
        const report = await time.listReport(f.user.id, { agentId: f.agent.id, teamScope: f.state.ctx.teamScope });
        assert.ok(report.some(entry => entry.task.projectId === 15));
        assert.equal(report.some(entry => entry.task.projectId === 25), actor !== 'bound');
      });
    });

    test(`${mode} ${actor}: Android composer authorizes before provider or model inventory calls`, async () => {
      const f = teamFixture(mode, actor);
      const lookedUp = [];
      const route = f.load('src/app/api/android/ai/composer/route.ts', {
        '@/utils/controllers/teams/getTeamAiSettingsForViewer': { getTeamAiSettingsForViewer: async (_user, _unused, teamId) => { lookedUp.push(teamId); return { ok: true, settings: {} }; } },
        '@/app/api/ai/_lib/byokKeys': { resolveTeamCustomEndpoint: async () => null, resolveTeamByokApiKey: async () => null, getAiDefaultModelContext: async () => ({ haiku55Enabled: false }) },
        '@/app/api/ai/_lib/planGate': { storePlanIdForProject: async () => 'Free' },
        './config': { providersRequiringByokCheck: () => [], buildComposerConfig: () => ({ models: ['fixture'] }) },
      });
      const a = await route.GET(req('android/ai/composer?project_id=15'));
      assert.equal(a.status, 200); assert.deepEqual((await a.json()).models, ['fixture']);
      const before = lookedUp.length;
      const b = await route.GET(req('android/ai/composer?project_id=25'));
      assert.equal(b.status, actor === 'bound' ? 404 : 200);
      assert.equal(lookedUp.length - before, actor === 'bound' ? 0 : 1);
    });

    test(`${mode} ${actor}: feature flag ticket titles are filtered by verified scope`, async () => {
      const f = teamFixture(mode, actor);
      f.prisma.featureFlag = f.model([], 'flag');
      const flagDefinitions = [{ key: 'htpr-7179-fixture', description: 'fixture', shippedOn: '2026-01-01' }];
      const flags = f.load('src/lib/flags.ts', { '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: flagDefinitions } });
      f.tasks[0].uniqueIndex = 7179;
      await f.run(req('mcp/flags'), async () => {
        const principal = { userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope };
        assert.equal((await flags.listFeatureFlagModes({ includeTicketTitles: true, principal }))[0].ticketTitle, 'A1-sentinel');
        f.projects[0].teamId = 'team-b';
        const moved = await flags.listFeatureFlagModes({ includeTicketTitles: true, principal });
        assert.equal(moved[0].ticketTitle, actor === 'bound' ? null : 'A1-sentinel');
      });
    });
  }
}

test('ops smoke does not convert bound credentials into a human cookie; ordinary human control is unchanged', () => {
  const f = teamFixture('WATCH');
  const { decideCoreSmokeAccess } = f.load('src/lib/productionSmoke/access.ts');
  assert.equal(decideCoreSmokeAccess({ user: f.user, agentId: null, teamScope: null }, true).ok, true);
  assert.deepEqual(decideCoreSmokeAccess({ user: f.user, agentId: null, teamScope }, true).status, 403);
  assert.equal(decideCoreSmokeAccess({ user: f.user, agentId: f.agent.id, teamScope }, true).status, 403);
});
