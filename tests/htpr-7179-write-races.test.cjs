const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture } = require('./helpers/htpr-7179-team.cjs');

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  for (const actor of ['bound', 'unbound']) {
    test(`${mode} ${actor}: report creation holds its owning project lock across the last scoped read and write`, async () => {
      const f = teamFixture(mode, actor);
      const trace = [];
      let locked = false;
      let inTransaction = false;
      let pendingMove = null;
      const project = f.projects[0];
      const read = f.prisma.project.findFirst;
      f.prisma.$queryRaw = async strings => { assert.match(String(strings), /Project.*FOR UPDATE/); locked = true; trace.push('lock'); return [{ id: project.id }]; };
      f.prisma.project.findFirst = async args => {
        const result = await read(args);
        if (inTransaction) {
          trace.push('final-read'); trace.push('move-attempt');
          const move = () => { project.teamId = 'team-b'; trace.push('move'); };
          if (locked) pendingMove = move; else move();
        }
        return result;
      };
      f.prisma.report = { create: async ({ data }) => {
        if (actor === 'bound') assert.equal(project.teamId, 'team-a', 'a move after the last read cannot precede the protected write');
        trace.push('write'); return { id: 1, ...data };
      } };
      f.prisma.$transaction = async run => {
        inTransaction = true;
        try { return await run(f.prisma); }
        finally { locked = false; inTransaction = false; trace.push('unlock'); pendingMove?.(); }
      };
      const reports = f.load('src/utils/controllers/reports/reportService.ts');
      await f.run(new NextRequest('http://localhost/api/mcp/reports/create'), async () => {
        const result = await reports.createReport({ userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope, projectId: 15, slug: 'fixture', title: 'Fixture', bodyHtml: '<p>A-content</p>' });
        assert.equal(result.id, 1);
        if (actor === 'bound') assert.deepEqual(trace, ['lock', 'final-read', 'move-attempt', 'write', 'unlock', 'move']);
        else assert.deepEqual(trace, ['write'], 'unbound report creation retains its original direct write');
        const before = trace.filter(event => event === 'write').length;
        const denied = await reports.createReport({ userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope, projectId: 25, slug: 'fixture-b', title: 'Fixture', bodyHtml: '<p>B-content</p>' });
        assert.equal(Boolean(denied), actor !== 'bound');
        assert.equal(trace.filter(event => event === 'write').length - before, actor === 'bound' ? 0 : 1);
      });
    });

    test(`${mode} ${actor}: view creation locks and rechecks before all project-view side effects`, async () => {
      for (const projectId of [15, 25]) {
        const f = teamFixture(mode, actor);
        const trace = [];
        let locked = false;
        let inTransaction = false;
        let move;
        const project = f.projects.find(row => row.id === projectId);
        const read = f.prisma.project.findFirst;
        f.prisma.project.findFirst = async args => {
          const result = await read(args);
          if (inTransaction) {
            trace.push('final-read');
            const change = () => { project.teamId = 'team-b'; trace.push('move'); };
            if (locked) move = change; else change();
          }
          return result;
        };
        f.prisma.$queryRaw = async strings => { assert.match(String(strings), /Project.*FOR UPDATE/); locked = true; trace.push('lock'); return []; };
        f.prisma.$transaction = async run => {
          inTransaction = true;
          try { return await run(f.prisma); }
          finally { locked = false; inTransaction = false; trace.push('unlock'); move?.(); }
        };
        f.prisma.project_View = { upsert: async () => { trace.push('project-view-write'); return { id: 'project-view' }; } };
        f.prisma.view = { findFirst: async () => null, create: async ({ data }) => {
          if (actor === 'bound') assert.equal(project.teamId, 'team-a');
          trace.push('view-write'); return { id: 'view', ...data };
        } };
        const views = f.load('src/lib/mcp/views/services.ts', {
          '@/utils/controllers/projects/views/viewsHelperAPIfunctions': { getUniqueSlug: async () => null },
          '@/utils/controllers/projects/views/boardFilterWriteLock': { acquireBoardFilterWriteLock: async () => {}, validateBoardFilterLabelReferences: async () => {} },
        });
        await f.run(new NextRequest('http://localhost/api/mcp/view'), async () => {
          const create = () => views.createView({ projectId, userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope, title: 'Fixture' });
          if (projectId === 25 && actor === 'bound') {
            await assert.rejects(create(), /not found|access denied/i);
            assert.deepEqual(trace, []);
          } else {
            assert.equal((await create()).id, 'view');
            assert.deepEqual(trace, actor === 'bound' ? ['lock', 'final-read', 'project-view-write', 'view-write', 'unlock', 'move'] : ['project-view-write', 'view-write', 'unlock']);
          }
        });
      }
    });

    test(`${mode} ${actor}: secondary URL and attachment reconciliation rechecks the current task/comment scope`, async () => {
      const f = teamFixture(mode, actor);
      f.prisma.$queryRaw = async () => [];
      const writes = [];
      const urls = f.load('src/utils/controllers/urls/extractUrlsFromContent.ts', {
        '@/utils/controllers/urls/addIntoTask': { default: async (...args) => { writes.push({ kind: 'comment', urls: args[0], db: args[3] }); } },
        '@/utils/controllers/urls/addIntoTaskDesc': { default: async (...args) => { writes.push({ kind: 'description', urls: args[0], db: args[3] }); } },
      });
      await f.run(new NextRequest('http://localhost/api/mcp/comments'), async () => {
        const principal = { userId: f.user.id, agentId: f.agent.id, teamScope: f.state.ctx.teamScope };
        for (const taskId of [150, 250]) {
          const before = writes.length;
          const comment = () => urls.persistUrlsForComment('https://fixture.example.invalid/path', taskId, taskId, 'POST', [], principal);
          const description = () => urls.persistUrlsForDescription('https://fixture.example.invalid/path', taskId, [], principal);
          if (taskId === 250 && actor === 'bound') {
            await assert.rejects(comment(), /Task not found or access denied/);
            await assert.rejects(description(), /Task not found or access denied/);
            assert.equal(writes.length, before);
          } else {
            await comment(); await description();
            assert.equal(writes.length, before + 2);
            if (actor === 'bound') assert.ok(writes.slice(before).every(write => write.db === f.prisma && write.urls.every(url => url.TaskId === taskId)));
          }
        }
        if (actor === 'bound') {
          f.tasks[0].project = f.projects[3]; f.tasks[0].projectId = 25;
          const before = writes.length;
          await assert.rejects(urls.persistUrlsForDescription('https://fixture.example.invalid/path', 150, [], principal), /Task not found or access denied/);
          assert.equal(writes.length, before);
        }
      });
    });

    test(`${mode} ${actor}: scoped task lock refuses a resource moved before the final guard; A and unbound B remain available`, async () => {
      const f = teamFixture(mode, actor);
      const trace = [];
      f.prisma.$queryRaw = async strings => { trace.push(String(strings)); return []; };
      const guard = f.load('src/lib/mcp/tasks/agentMutationFence.ts');
      await f.run(new NextRequest('http://localhost/api/mcp/tasks/session'), async () => {
        await guard.lockTaskTeamScope(f.prisma, 150, f.user.id, f.agent.id, f.state.ctx.teamScope);
        assert.equal(trace.length, actor === 'bound' ? 1 : 0);
        f.tasks[0].project = f.projects[3]; f.tasks[0].projectId = 25;
        if (actor === 'bound') await assert.rejects(guard.lockTaskTeamScope(f.prisma, 150, f.user.id, f.agent.id, f.state.ctx.teamScope), guard.TaskTeamScopeError);
        else await guard.lockTaskTeamScope(f.prisma, 150, f.user.id, f.agent.id, null);
      });
    });
  }
}
