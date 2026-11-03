const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-8243 board switch address hold is a reversible low-risk bugfix for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8243-board-switch-address.ts');
  assert.equal(flag.key, 'htpr-8243-board-switch-address');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
