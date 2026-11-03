const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-8260 composer keys is a reversible low-risk improvement for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8260-ctrlj-composer-keys.ts');
  assert.equal(flag.key, 'htpr-8260-ctrlj-composer-keys');
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
