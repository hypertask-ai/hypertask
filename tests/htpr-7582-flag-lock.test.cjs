const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, loader, ctx, session, NOW, FLAG } = require('./htpr-7582-fixtures.cjs');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function flagFixture() {
  const f = fixture();
  let mode = 'EVERYONE';
  const events = [];
  f.db.featureFlag = {
    findUnique: async () => { events.push('database-flag-read'); return { key: FLAG, mode }; },
    upsert: async ({ update }) => { mode = update.mode; events.push(`mode:${mode}`); return { key: FLAG, ...update }; },
  };
  f.db.task = { findMany: async () => [] };
  const transact = f.db.$transaction;
  f.db.$transaction = (run, options) => transact(() => run(Object.create(f.db)), options);
  const flags = loader({ ...f.stubs,
    '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [{ key: FLAG, defaultMode: 'EVERYONE' }] },
    react: { cache: run => run },
    '@/lib/flags/modeCache': { withFlagModeInvalidation: run => run(), flagModeScope: { getStore: () => ({ modes: Promise.resolve(null) }) } },
  })('src/lib/flags.ts');
  const service = loader({ ...f.stubs, '@/lib/flags': flags })('src/lib/agents/boardAccessRequests/service.ts');
  return { ...f, flags, service, events };
}
test('request transactions use the exact flag-setter advisory key before owner locks and flag reads', async () => {
  const f = flagFixture(); const locks = [];
  f.db.$executeRaw = async (sql, ...args) => { locks.push({ sql: sql.join('?').replace(/\s+/g, ' ').trim(), args }); f.events.push('flag-lock'); return 0; };
  f.db.$queryRaw = async () => { f.events.push('owner-lock'); return [{ id: 6 }]; };
  const result = await f.service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'x' }, NOW);
  assert.deepEqual(f.events.slice(0, 3), ['flag-lock', 'owner-lock', 'database-flag-read']);
  const id = result.request.id;
  f.state.requests[0].expiresAt = new Date(Date.now() + 60000);
  for (const run of [
    () => f.service.getBoardAccessRequest(ctx(), id, NOW),
    () => f.service.getOwnerBoardAccessNotifications(session(), 'Normal', NOW),
    () => f.service.mutateBoardAccessNotification(session(), 1, null, { seen: true }),
    () => f.service.decideBoardAccessRequest(session(), id, 'decline', NOW),
    () => f.service.cleanupBoardAccessRequests(NOW),
  ]) {
    const before = locks.length; await run(); assert.equal(locks.length, before + 1);
  }
  await f.flags.setFeatureFlagMode(FLAG, 'OFF');
  assert.ok(locks.length > 1);
  for (const lock of locks) {
    assert.deepEqual(lock, locks.at(-1));
    assert.deepEqual(lock.args, [6193, FLAG]);
    assert.match(lock.sql, /pg_advisory_xact_lock\( CAST\(\? AS integer\), hashtext\(\?\) \)/);
  }
});
for (const first of ['OFF', 'create']) {
  test(`${first} wins the shared lock: OFF and creation serialize`, { timeout: 5000 }, async () => {
    const f = flagFixture(); const acquired = deferred(); const waiting = deferred(); const releaseFirst = deferred();
    const tails = new Map(); let transactions = 0;
    f.db.$transaction = async run => {
      const id = ++transactions; const release = [];
      const tx = Object.create(f.db);
      tx.$executeRaw = async (_sql, ...args) => {
        const key = JSON.stringify(args);
        const previous = tails.get(key) ?? Promise.resolve();
        const done = deferred(); tails.set(key, done.promise); release.push(done.resolve);
        if (id === 2) waiting.resolve();
        await previous;
        f.events.push(`lock:${id}`);
        if (id === 1) { acquired.resolve(); await releaseFirst.promise; }
        return 0;
      };
      tx.$queryRaw = async () => { f.events.push(`owner:${id}`); return [{ id: 6 }]; };
      try { return await run(tx); } finally { for (const unlock of release) unlock(); }
    };
    const create = () => f.service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'x' }, NOW);
    const off = () => f.flags.setFeatureFlagMode(FLAG, 'OFF');
    const leading = (first === 'OFF' ? off : create)();
    await acquired.promise;
    const trailing = (first === 'OFF' ? create : off)();
    const settled = Promise.allSettled([leading, trailing]);
    await waiting.promise;
    assert.ok(!f.events.includes('lock:2'));
    assert.ok(!f.events.includes('owner:2'));
    assert.equal(f.state.requests.length, 0);
    releaseFirst.resolve();
    const results = await settled;
    assert.equal(results[0].status, 'fulfilled');
    if (first === 'OFF') {
      assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.code, 'feature_disabled');
      assert.equal(f.state.requests.length, 0); assert.equal(f.state.notifications.length, 0);
    } else {
      assert.equal(results[1].status, 'fulfilled'); assert.equal(f.state.requests.length, 1);
      assert.equal(f.state.requests[0].status, 'cancelled');
      assert.equal(f.state.requests[0].resolutionReason, 'feature_disabled');
      assert.equal(f.state.notifications.length, 1);
    }
    assert.equal(f.state.requests.filter(row => row.status === 'pending').length, 0);
  });
}
test('transactional flag reads bypass stale request caches and fail closed on database errors', async () => {
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = 'redis://offline-fixture';
  try {
    const f = flagFixture();
    const cache = { modes: Promise.resolve([{ key: FLAG, mode: 'EVERYONE' }]) };
    const load = loader({ ...f.stubs,
      '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [{ key: FLAG, defaultMode: 'EVERYONE' }] },
      '@/lib/flags/modeCache': { flagModeScope: { getStore: () => cache } },
      react: { cache: run => run },
    });
    const flags = load('src/lib/flags.ts');
    assert.equal(await flags.isFeatureEnabled(FLAG, 6), true);
    f.db.featureFlag.findUnique = async () => { f.events.push('uncached-OFF'); return { mode: 'OFF' }; };
    f.db.$transaction = async run => run(Object.create(f.db));
    const service = loader({ ...f.stubs, '@/lib/flags': flags })('src/lib/agents/boardAccessRequests/service.ts');
    await assert.rejects(service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'x' }, NOW), error => error.code === 'feature_disabled');
    assert.equal(f.state.requests.length, 0); assert.equal(f.state.notifications.length, 0);
    assert.ok(f.events.includes('uncached-OFF'));
    cache.modes = Promise.resolve([{ key: FLAG, mode: 'OFF' }]);
    f.db.featureFlag.findUnique = async () => ({ key: FLAG, mode: 'EVERYONE' });
    assert.equal((await service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'x' }, NOW)).created, true);
    f.db.featureFlag.findUnique = async () => { throw Error('database unavailable'); };
    await assert.rejects(service.createBoardAccessRequest(ctx(), { project_id: 15, reason: 'x' }, NOW), error => error.code === 'feature_disabled');
  } finally {
    if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous;
  }
});

test('ticket flag transitions retry serialization conflicts and reacquire their advisory lock', async () => {
  const f = flagFixture();
  const transaction = f.db.$transaction; let attempts = 0; const locks = [];
  const execute = f.db.$executeRaw;
  f.db.$executeRaw = async (sql, ...args) => { locks.push(args); return execute(sql, ...args); };
  f.db.$transaction = async (run, options) => {
    assert.equal(options.isolationLevel, 'Serializable'); attempts++;
    return transaction(async tx => {
      const result = await run(tx);
      if (attempts === 1) throw { code: 'P2034' };
      return result;
    }, options);
  };
  await f.flags.setFeatureFlagMode(FLAG, 'OFF');
  assert.equal(attempts, 2); assert.equal(locks.length, 2);
  assert.deepEqual(locks[0], locks[1]);
});
test('ticket flag serialization retries are bounded', async () => {
  const f = flagFixture(); let attempts = 0;
  f.db.$transaction = async (_run, options) => { assert.equal(options.isolationLevel, 'Serializable'); attempts++; throw { code: 'P2034' }; };
  await assert.rejects(f.flags.setFeatureFlagMode(FLAG, 'OFF'), error => error.code === 'P2034');
  assert.equal(attempts, 4);
});
