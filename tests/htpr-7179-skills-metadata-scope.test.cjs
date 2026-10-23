const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture, teamScope } = require('./helpers/htpr-7179-team.cjs');
const request = (path, method = 'GET', body) => new NextRequest(`http://localhost/api/mcp/${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound', 'human']) {
    test(`${mode} ${actor}: project skills/instructions stay available in A, B and account-global operations are refused only for bound credentials`, async () => {
      const f = teamFixture(mode, actor);
      const skills = [
        { id: 1, userId: f.user.id, projectId: null, project: null, slug: 'personal', name: 'Personal', enabled: true, body: 'global-sentinel' },
        ...[f.projects[0], f.projects[3]].map(project => ({ id: project.id, userId: null, projectId: project.id, project, slug: 'project', name: project.name, enabled: true, body: `${project.name}-skill` })),
      ];
      f.prisma.$queryRaw = async () => [];
      f.prisma.aI_Skill = f.model(skills, 'skill');
      f.prisma.aI_Custom_Instructions = f.model([f.projects[0], f.projects[3]].map(project => ({ id: project.id, projectId: project.id, project, customInstruction: `${project.name}-instructions` })), 'instructions');
      let imports = 0;
      Object.assign(f.mocks, {
        '@/app/api/ai/_lib/modelProvider': {}, '@/app/api/ai/_lib/byokKeys': {},
        '@/app/api/ai/_lib/planGate': { haiku55ModelEnabled: async () => false },
        '@/app/api/ai/_lib/skillImport': { importSkillsFromGitHub: async () => { imports++; return [{ slug: 'import', name: 'Import', body: 'fixture' }]; } },
      });
      const route = f.load('src/lib/mcp/operations/skills/operation.ts');
      const item = f.load('src/lib/mcp/operations/skills/[skill_id]/operation.ts');
      const importer = f.load('src/lib/mcp/operations/skills/import/operation.ts');
      const instruction = f.load('src/lib/mcp/operations/projects/[projectId]/instructions/operation.ts');
      const resolver = f.load('src/app/api/ai/_lib/skills.ts');
      for (const projectId of [15, 25]) {
        const res = await route.GET(request(`skills?project_id=${projectId}`));
        const allowed = projectId === 15 || actor !== 'bound';
        assert.equal(res.status, allowed ? 200 : 403);
        if (allowed) {
          const body = await res.json();
          assert.ok(body.skills.some(skill => skill.projectId === projectId));
          assert.equal(body.skills.some(skill => skill.projectId === null), actor !== 'bound');
        }
        const instructions = await instruction.GET(request(`projects/${projectId}/instructions`), { params: Promise.resolve({ projectId: String(projectId) }) });
        assert.equal(instructions.status, allowed ? 200 : 403);
        if (!allowed) assert.doesNotMatch(await instructions.text(), /B1-instructions/);
      }
      assert.equal((await route.GET(request('skills'))).status, actor === 'bound' ? 403 : 200);
      assert.equal((await item.GET(request('skills/1'), { params: Promise.resolve({ skill_id: '1' }) })).status, actor === 'bound' ? 403 : 200);
      const beforePatch = f.writes.length;
      const patched = await item.PATCH(request('skills/1', 'PATCH', { body: 'global-sentinel' }), { params: Promise.resolve({ skill_id: '1' }) });
      assert.equal(patched.status, actor === 'bound' ? 403 : 200);
      if (actor === 'bound') assert.equal(f.writes.length, beforePatch);
      for (const projectId of [15, 25]) {
        const beforeWrite = f.writes.length;
        const created = await route.POST(request('skills', 'POST', { scope: 'project', project_id: projectId, name: 'Fixture', body: 'fixture' }));
        const changed = await instruction.PUT(request(`projects/${projectId}/instructions`, 'PUT', { custom_instruction: 'fixture' }), { params: Promise.resolve({ projectId: String(projectId) }) });
        const allowed = projectId === 15 || actor !== 'bound';
        assert.equal(created.status, allowed ? 201 : 403);
        assert.equal(changed.status, allowed ? 200 : 403);
        if (!allowed) assert.equal(f.writes.length, beforeWrite);
      }
      const before = f.writes.length;
      const globalCreate = await route.POST(request('skills', 'POST', { scope: 'user', name: 'Fixture', body: 'fixture' }));
      assert.equal(globalCreate.status, actor === 'bound' ? 403 : 201);
      if (actor === 'bound') assert.equal(f.writes.length, before);
      const imported = await importer.POST(request('skills/import', 'POST', { scope: 'user', url: 'https://github.com/example/fixture', dry_run: true }));
      assert.equal(imported.status, actor === 'bound' ? 403 : 200);
      assert.equal(imports, actor === 'bound' ? 0 : 1);
      await f.run(request('ai/task-writer'), async () => {
        const principal = { userId: f.user.id, agentId: f.state.ctx.agentId, teamScope: f.state.ctx.teamScope, projectId: 15 };
        const project = await resolver.resolveSkills('/project Draft', principal);
        assert.match(project.systemPromptAddition, /A1-skill/);
        if (actor === 'bound') await assert.rejects(resolver.resolveSkills('/personal Draft', principal), error => error.status === 403);
        else assert.match((await resolver.resolveSkills('/personal Draft', principal)).systemPromptAddition, /global-sentinel/);
      });
      const beforeDelete = f.writes.length;
      const deleted = await item.DELETE(request('skills/1', 'DELETE'), { params: Promise.resolve({ skill_id: '1' }) });
      assert.equal(deleted.status, actor === 'bound' ? 403 : 200);
      if (actor === 'bound') assert.equal(f.writes.length, beforeDelete);
    });

    test(`${mode} ${actor}: context inventories and requested-team presence do not expose B metadata`, async () => {
      const f = teamFixture(mode, actor);
      f.user.accountId = 'account';
      f.agent.displayName = 'A-agent';
      f.prisma.agent = f.model([f.agent, { ...f.agent, id: 'b-agent', displayName: 'B-agent', members: [{ project: f.projects[3] }] }, { ...f.agent, id: 'mixed-agent', members: [{ project: f.projects[0] }, { project: f.projects[3] }] }], 'agent');
      const teams = ['team-a', 'team-b'].map(id => ({ id, title: `${id}-sentinel`, googleAccountId: 'account' }));
      f.prisma.team = f.model(teams, 'team');
      f.prisma.member_Team = f.model(teams.map((team, id) => ({ id, userId: f.user.id, teamId: team.id, team, status: 'Accepted' })), 'team-member');
      const ctx = f.load('src/lib/mcp/operations/user/context/operation.ts');
      const context = await ctx.GET(request('user/context'));
      assert.equal(context.status, 200);
      const contextBody = await context.json();
      assert.equal(JSON.stringify(contextBody).includes('team-b-sentinel'), actor !== 'bound');
      assert.equal(contextBody.all_agents.some(agent => agent.id === 'b-agent'), actor !== 'bound');
      assert.equal(contextBody.all_agents.some(agent => agent.id === 'mixed-agent'), actor !== 'bound');
      const calls = [];
      const presence = f.load('src/lib/mcp/operations/agents/presence/operation.ts', { '@/lib/mcp/agents/presence': { getTeamAgentPresence: async (id, principal) => { calls.push({ id, principal }); return [{ agent: { id: 'fixture' } }]; }, TeamAgentPresenceNotFoundError: class extends Error {} } });
      const a = await presence.GET(request('agents/presence?team_id=team-a'));
      assert.equal(a.status, 200);
      const before = calls.length;
      const b = await presence.GET(request('agents/presence?team_id=team-b'));
      assert.equal(b.status, actor === 'bound' ? 404 : 200);
      assert.equal(calls.length - before, actor === 'bound' ? 0 : 1);
      if (actor === 'bound') assert.deepEqual(calls[0].principal.teamScope, teamScope);
    });
  }
}
