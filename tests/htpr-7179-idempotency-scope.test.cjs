const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { teamFixture, teamScope } = require('./helpers/htpr-7179-team.cjs');

for (const mode of ['WATCH', 'ENFORCE', 'FLAG_ERROR']) {
  test(`${mode}: scoped idempotency keys separate agent and grant, replay reauthorizes moved resources without repeating writes`, async () => {
    const f = teamFixture(mode);
    const cached = new Map();
    const redis = {
      get: async key => cached.get(key) ?? null,
      set: async (key, value, ...options) => { if (options.includes('NX') && cached.has(key)) return null; cached.set(key, value); return 'OK'; },
      del: async key => cached.delete(key),
    };
    f.prisma.report = f.model(f.tasks.map(task => ({ id: task.id, project: task.project })), 'report');
    const cache = f.load('src/lib/mcp/idempotency/idempotencyStore.ts', { '@/lib/redis': { getRedis: async () => redis } });
    const key = (...scope) => cache.createIdempotencyRedisKey('create_task', f.user.id, 'fixture', {}, ...scope);
    assert.equal(key(), key(undefined, null), 'unbound key remains byte-identical');
    assert.notEqual(key(), key(f.agent.id, teamScope));
    assert.notEqual(key(f.agent.id, teamScope), key('other-agent', teamScope));
    assert.notEqual(key(f.agent.id, teamScope), key(f.agent.id, { ...teamScope, accessBinding: 'owner:account-a:1' }));
    const old = { task: { id: 250, projectId: 25, title: 'B-cached' } };
    cached.set(key(), JSON.stringify(old));
    let writes = 0;
    const producer = async () => { writes++; return { task: { id: 150, projectId: 15, title: 'A-cached' } }; };
    await f.run(new NextRequest('http://localhost/api/mcp/tasks/create'), async () => {
      const a = await cache.withIdempotency('create_task', f.user.id, 'fixture', {}, producer, f.agent.id, teamScope);
      assert.equal(a.task.title, 'A-cached'); assert.equal(writes, 1);
      const retry = await cache.withIdempotency('create_task', f.user.id, 'fixture', {}, producer, f.agent.id, teamScope);
      assert.equal(retry.idempotent_replayed, true); assert.equal(writes, 1);
      const unbound = await cache.withIdempotency('create_task', f.user.id, 'fixture', {}, producer);
      assert.equal(unbound.task.title, 'B-cached'); assert.equal(writes, 1);
      for (const [operation, aResult, bResult] of [
        ['create_task', { task: { id: 150 } }, old],
        ['update_task', { tasks: [{ id: 150 }] }, { tasks: [{ id: 250, title: 'B-cached' }] }],
        ['create_page', { page: { publicId: 'page-15' } }, { page: { publicId: 'page-25', title: 'B-cached' } }],
        ['create_report', { report: { id: 150 } }, { report: { id: 250, body_html: 'B-cached' } }],
        ['create_comment', { comment: { id: 150 } }, { comment: { id: 250, text: 'B-cached' } }],
        ['create_board', { board: { id: 15 } }, { board: { id: 25, title: 'B-cached' } }],
      ]) {
        const replayKey = cache.createIdempotencyRedisKey(operation, f.user.id, 'legacy', {}, f.agent.id, teamScope);
        cached.set(replayKey, JSON.stringify(aResult));
        assert.equal((await cache.withIdempotency(operation, f.user.id, 'legacy', {}, producer, f.agent.id, teamScope)).idempotent_replayed, true);
        cached.set(replayKey, JSON.stringify(bResult));
        await assert.rejects(cache.withIdempotency(operation, f.user.id, 'legacy', {}, producer, f.agent.id, teamScope), cache.IdempotencyAccessError);
        assert.equal(writes, 1, 'a refusal cannot fall through to the producer');
      }
      const lookup = f.prisma.task.findFirst;
      f.prisma.task.findFirst = async () => { throw new Error('fixture lookup unavailable'); };
      await assert.rejects(cache.withIdempotency('create_task', f.user.id, 'fixture', {}, producer, f.agent.id, teamScope), cache.IdempotencyAccessError);
      assert.equal(writes, 1, 'lookup errors cannot repeat a protected write');
      f.prisma.task.findFirst = lookup;
      f.tasks[0].project = f.projects[3]; f.tasks[0].projectId = 25;
      await assert.rejects(cache.withIdempotency('create_task', f.user.id, 'fixture', {}, producer, f.agent.id, teamScope), cache.IdempotencyAccessError);
      assert.equal(writes, 1);
    });
  });
}
