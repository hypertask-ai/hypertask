const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

function harness(options = {}) {
  const keys = new Map(), claims = [], warnings = [];
  let seconds = 121;
  const redis = {
    eval: async (script, numberOfKeys, key, ttl) => {
      claims.push({ script, numberOfKeys, key, ttl });
      assert.equal(numberOfKeys, 1);
      // The server-side claim must remain one atomic script, including expiry validation.
      assert.match(script, /redis\.call\('INCR', KEYS\[1\]\)/);
      assert.match(script, /if count == 1 then[\s\S]*redis\.call\('EXPIRE', KEYS\[1\], ARGV\[1\]\)/);
      assert.match(script, /expires ~= 1 then return -1/);
      assert.match(script, /redis\.call\('TTL', KEYS\[1\]\) < 0 then return -1/);
      if (options.evalFailure) throw new Error('fake storage outage with sensitive details');
      if (Object.hasOwn(options, 'counter')) return options.counter;
      const entry = keys.get(key);
      const row = entry && entry.expiresAt > seconds ? entry : { count: 0, expiresAt: seconds + ttl };
      row.count++;
      keys.set(key, row);
      return row.count;
    },
  };
  const { checkRestRateLimit } = load('src/lib/api/rateLimit.ts', {
    '@/lib/redis': { getRedis: async () => { if (options.connectFailure) throw new Error('fake connection failure'); return redis; } },
  });
  async function check(userId = 985, bucket = 'read') {
    const realNow = Date.now, realWarn = console.warn;
    Date.now = () => seconds * 1000;
    console.warn = (message) => warnings.push(message);
    try { return await checkRestRateLimit(userId, bucket); }
    finally { Date.now = realNow; console.warn = realWarn; }
  }
  return { check, claims, keys, warnings, time: (value) => { seconds = value; } };
}

for (const [bucket, limit] of [['read', 120], ['write', 60]]) {
  test(`${bucket}: inclusive threshold, one atomic claim/request, fixed-boundary TTL and exact 429`, async () => {
    const h = harness();
    for (let count = 1; count <= limit; count++) assert.equal(await h.check(985, bucket), null);
    const response = await h.check(985, bucket);
    assert.equal(response.status, 429);
    assert.equal(await response.text(), '{"error":"Rate limit exceeded. Please try again shortly."}');
    assert.deepEqual([...response.headers], [['content-type', 'application/json'], ['retry-after', '59']]);
    assert.equal(h.claims.length, limit + 1);
    assert.deepEqual(h.claims.map(({ key }) => key), Array(limit + 1).fill(`rest:htpr-6924:985:${bucket}:120`));
    assert.ok(h.claims.every(({ ttl }) => ttl === 59));
    assert.equal(h.keys.get(h.claims[0].key).expiresAt, 180);
    h.time(179.999);
    assert.equal((await h.check(985, bucket)).headers.get('retry-after'), '1');
    h.time(180);
    assert.equal(await h.check(985, bucket), null);
    assert.equal(h.claims.at(-1).key, `rest:htpr-6924:985:${bucket}:180`);
    assert.equal(h.claims.at(-1).ttl, 60);
  });
}

test('users and read/write buckets have independent counters and no cookies, bodies or tokens in keys', async () => {
  const h = harness();
  for (let count = 0; count < 120; count++) await h.check();
  assert.equal((await h.check()).status, 429);
  assert.equal(await h.check(7), null);
  assert.equal(await h.check(985, 'write'), null);
  assert.deepEqual([...h.keys.keys()], ['rest:htpr-6924:985:read:120', 'rest:htpr-6924:7:read:120', 'rest:htpr-6924:985:write:120']);
});

test('concurrent requests share one atomic budget; first use sets expiry and later claims do not extend it', async () => {
  const h = harness();
  // Hold the clock for the whole concurrent batch; do not patch globals per call.
  const now = Date.now;
  Date.now = () => 121000;
  try {
    const helper = load('src/lib/api/rateLimit.ts', { '@/lib/redis': { getRedis: async () => ({ eval: async (script, n, key, ttl) => {
      assert.equal(n, 1);
      const row = h.keys.get(key) ?? { count: 0, expiresAt: 121 + ttl };
      h.keys.set(key, row);
      row.count++;
      return row.count;
    } }) } });
    const results = await Promise.all(Array.from({ length: 200 }, () => helper.checkRestRateLimit(985, 'write')));
    assert.equal(results.filter((result) => result === null).length, 60);
    assert.equal(results.filter((result) => result?.status === 429).length, 140);
    assert.deepEqual(h.keys.get('rest:htpr-6924:985:write:120'), { count: 200, expiresAt: 180 });
  } finally { Date.now = now; }
});

for (const [name, options] of [
  ['connection failure', { connectFailure: true }], ['claim failure', { evalFailure: true }],
  ['expiry failure', { counter: -1 }], ['missing count', { counter: null }], ['zero count', { counter: 0 }],
  ['non-numeric count', { counter: '121' }], ['NaN', { counter: NaN }], ['fraction', { counter: 1.5 }], ['unsafe count', { counter: Number.MAX_SAFE_INTEGER + 1 }],
]) {
  test(`${name}: availability limiter fails open without retry/double-charge or leaking infrastructure details`, async () => {
    const h = harness(options);
    assert.equal(await h.check(), null);
    assert.equal(h.claims.length, options.connectFailure ? 0 : 1);
    assert.deepEqual(h.warnings, ['[rest-rate-limit] Counter unavailable; allowing request']);
  });
}

test('Retry-After is measured at the response boundary, including storage delay and a crossed window', async () => {
  const saved = Date.now;
  try {
    for (const responseTime of [150000, 180000]) {
      let clock = 121000;
      Date.now = () => clock;
      const { checkRestRateLimit } = load('src/lib/api/rateLimit.ts', {
        '@/lib/redis': { getRedis: async () => ({ eval: async () => { clock = responseTime; return 121; } }) },
      });
      const response = await checkRestRateLimit(985, 'read');
      assert.equal(response.headers.get('retry-after'), responseTime === 150000 ? '30' : '1');
    }
  } finally { Date.now = saved; }
});
