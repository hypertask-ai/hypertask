const assert = require('node:assert/strict');
const test = require('node:test');
const { definitions } = require('./helpers/flag-files.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');

test('first-visit flag seed is a discovered Everyone bugfix with a small release risk', () => {
  const definition = definitions().find(item => item.key === 'htpr-7718-first-visit-flag-seed');
  assert.ok(definition);
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.shippedOn, '2026-10-24');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.releaseRisk.risk, 'small');
  assert.ok(definition.releaseRisk.reason);
});

test('first-visit seed preserves every evaluated flag and rejects invalid account scopes before lookup', async () => {
  const calls = [];
  const values = { 'visible-ticket-flag': true, 'disabled-flag': false };
  const { getFirstVisitFlagSeed } = loadModule('src/lib/firstScreen/serverFlags.ts', {
    '@/lib/flags': { featureFlagsForUser: async accountId => { calls.push(accountId); return values; } },
  });
  const before = Date.now();
  const seed = await getFirstVisitFlagSeed(985);
  assert.equal(seed.accountId, 985);
  assert.deepEqual(seed.values, values);
  assert.ok(Date.parse(seed.evaluatedAt) >= before && Date.parse(seed.evaluatedAt) <= Date.now());
  for (const accountId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(getFirstVisitFlagSeed(accountId), /Invalid first-screen flag scope/);
  }
  assert.deepEqual(calls, [985]);
  const failing = loadModule('src/lib/firstScreen/serverFlags.ts', {
    '@/lib/flags': { featureFlagsForUser: async () => { throw Error('flags unavailable'); } },
  });
  await assert.rejects(failing.getFirstVisitFlagSeed(985), /flags unavailable/);
});
