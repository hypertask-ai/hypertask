const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, matches } = require('./helpers/agent-board-scope.cjs');

function response() {
  return { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

for (const [file, method] of [
  ['cancelInvite', 'POST'],
  ['createInviteLink', 'POST'],
  ['generatePublicInvite', 'GET'],
  ['generatePublicInvite', 'POST'],
]) {
  for (const actor of ['agent', 'team-agent', 'outside', 'revoked', 'pending', 'other-team', 'owner', 'member', 'anonymous']) {
    test(`${file} ${method}: ${actor} keeps its own invitation boundary`, async () => {
      const f = fixture();
      const projectId = actor === 'outside' ? 2128 : 15;
      const project = f.projects.find(row => row.id === projectId);
      if (actor === 'revoked') f.agent.revokedAt = new Date();
      if (actor === 'pending') project.members[0].status = 'Pending';
      if (actor === 'member') {
        project.ownerId = 7;
        project.members.push({ userId: f.user.id, agentId: null });
      }
      for (const member of project.members) member.user = f.user;
      const human = actor === 'owner' || actor === 'member';
      const session = actor === 'anonymous' ? null : {
        userId: f.user.id,
        agentId: human ? undefined : f.agent.id,
        teamScope: ['team-agent', 'other-team'].includes(actor) ? { teamId: actor === 'team-agent' ? 'team' : 'other-team', accessBinding: 'binding' } : null,
      };
      const findProject = f.prisma.project.findFirst;
      f.prisma.project.findFirst = async (args) => {
        if (actor === 'team-agent') assert.equal(matches({ ...project, teamId: 'moved-team' }, args.where), false);
        return findProject(args);
      };
      let inviteReads = 0;
      f.prisma.invite = {
        findFirst: async () => { inviteReads++; return { id: 'old-invite' }; },
        findMany: async () => { inviteReads++; return []; },
        deleteMany: async () => { f.writes.push('invite-delete'); return { count: 1 }; },
        update: async () => { f.writes.push('invite-update'); return {}; },
        create: async () => { f.writes.push('invite-create'); return { id: 'new-invite', uses: -1, project: { name: project.name } }; },
      };
      f.prisma.notification_Invite = {
        findFirst: async () => ({ notificationId: 1 }),
        deleteMany: async () => ({}),
      };
      f.prisma.team.findFirst = async () => ({ googleAccount: { userId: f.user.id }, members: [] });
      const mocks = {
        '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
        '@/lib/auth/unverifiedEmailAccount': { unverifiedEmailAccount: async () => 'allowed' },
        '@/lib/demo/guestGuard': { isGuestRequest: async () => false },
        '@/lib/telemetry/analyticsIntents': { processAnalyticsIntentSoon: () => {} },
        '@/lib/telemetry/inviteAnalytics': { enqueueInviteSent: async () => 'intent' },
        '@/utils/controllers/projects/getAll': { getProjectViewInclude: () => ({}) },
        '@/utils/helperFunctions/Views/ViewsHelperFunctions': { getViewFromProject: () => undefined },
        '@/utils/controllers/notifications/sendNotification': { sendEmailNotification: async () => assert.fail('No email should be sent') },
        '@/utils/api/invite/generatePublicInviteController': { getInviteFromProjectId: async () => { inviteReads++; return { inviteLink: 'allowed-invite' }; } },
      };
      if (file === 'generatePublicInvite') {
        mocks['./createInviteLink'] = { generateInviteLink: async () => 'allowed-invite', setViewSlug: () => undefined };
      }
      const handler = f.load(`src/pages/api/invite/${file}.ts`, mocks).default;
      const req = { method, headers: {}, query: { projectId: String(projectId) }, body: { projectId, emails: [], email: 'member@example.invalid' } };
      const res = response();
      await f.run(req, () => handler(req, res));
      const allowed = ['agent', 'team-agent', 'owner', 'member'].includes(actor);
      if (allowed) {
        assert.equal(res.statusCode, 200);
        assert.ok(inviteReads > 0);
        if (file === 'cancelInvite') assert.ok(f.writes.includes('invite-delete'));
        if (file === 'generatePublicInvite' && method === 'POST') assert.ok(f.writes.includes('invite-create'));
      } else {
        assert.equal(res.statusCode, actor === 'anonymous' ? 401 : file === 'generatePublicInvite' ? 400 : 404);
        assert.equal(inviteReads, 0);
        assert.deepEqual(f.writes, []);
      }
    });
  }
}
