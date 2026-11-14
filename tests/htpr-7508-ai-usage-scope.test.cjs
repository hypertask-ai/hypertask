const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, matches } = require('./helpers/agent-board-scope.cjs');

for (const actor of ['agent', 'team-agent', 'owner', 'admin', 'revoked', 'pending', 'zero', 'other-team', 'moved', 'anonymous']) {
  test(`AI usage preserves the ${actor} board boundary`, async (t) => {
    const f = fixture();
    const human = ['owner', 'admin'].includes(actor);
    f.state.ctx.agentId = human ? null : f.agent.id;
    if (actor === 'revoked') f.agent.revokedAt = new Date();
    if (actor === 'pending') f.projects.forEach(project => project.members.forEach(member => { member.status = 'Pending'; }));
    if (actor === 'zero') f.projects.forEach(project => { project.members = []; });
    const teamScope = ['team-agent', 'other-team'].includes(actor) ? { teamId: actor === 'team-agent' ? 'team' : 'other-team', accessBinding: 'binding' } : null;
    const session = actor === 'anonymous' ? null : { userId: f.user.id, agentId: f.state.ctx.agentId, teamScope };
    const usage = f.tasks.map(task => {
      task.title = `Private task ${task.projectId}`;
      task.project.title = `Private board ${task.projectId}`;
      return { projectId: task.projectId, taskId: task.id, teamId: 'team', feature: 'chat', agentId: null, provider: 'gateway', model: 'model', totalTokens: 10, createdAt: new Date() };
    });
    let aggregates = 0;
    f.prisma.aiUsage = { groupBy: async ({ by, where }) => {
      aggregates++;
      const rows = usage.filter(row => matches(row, where));
      if (actor === 'moved') f.projects.forEach(project => { project.members = []; });
      return rows.map(row => ({ ...Object.fromEntries(by.map(key => [key, row[key]])), _sum: { totalTokens: row.totalTokens } }));
    } };
    f.prisma.team.findUnique = async () => ({ googleAccount: { userId: actor === 'admin' ? 7 : f.user.id }, googleAccountId: 'team-owner' });
    const oldFetch = global.fetch;
    global.fetch = async () => Response.json({}, { status: 401 });
    t.after(() => { global.fetch = oldFetch; });
    const { GET } = f.load('src/app/api/settings/ai-usage/route.ts', {
      '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
      '@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess': { default: async () => true },
      '@/app/api/ai/_lib/byokKeys': { getTeamGatewayFunding: async () => ({ source: 'managed', apiKey: 'synthetic-report-key' }) },
      '@/app/api/ai/_lib/planAllowancePolicy': { resolveTeamAllowancePolicy: async () => ({ mode: 'legacy' }) },
      '@/app/api/ai/_lib/planGate': { storePlanIdForProject: async () => 'Pro' },
      '@/lib/flags': { isFeatureEnabled: async (key) => key === 'htpr-7743-ai-usage-auth' },
    });
    const request = new Request(`https://example.invalid/api/settings/ai-usage?teamId=team${actor === 'admin' ? '&projectId=15' : ''}`);
    const response = await f.run(request, () => GET(request));
    assert.equal(response.status, actor === 'anonymous' ? 401 : 200);
    const body = await response.json();
    if (actor === 'anonymous') {
      assert.equal(aggregates, 0);
      return;
    }
    const ids = actor === 'owner' ? [15, 4060, 2128] : actor === 'admin' ? [15] : ['agent', 'team-agent'].includes(actor) ? [15, 4060] : [];
    assert.deepEqual(body.boards.filter(row => row.label.startsWith('Private')).map(row => row.label).sort(), ids.map(id => `Private board ${id}`).sort());
    assert.deepEqual(body.tasks.filter(row => row.label.includes('Private')).map(row => row.label).sort(), ids.map(id => `HTPR-${id} · Private task ${id}`).sort());
    if (['revoked', 'pending', 'zero', 'other-team'].includes(actor)) {
      assert.deepEqual(body.boards, []);
      assert.deepEqual(body.tasks, []);
      assert.deepEqual(body.features, []);
    }
  });
}
