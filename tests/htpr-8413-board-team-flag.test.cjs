const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-8413 board team id is a small reversible improvement for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8413-board-team-id.ts');
  assert.equal(flag.key, 'htpr-8413-board-team-id');
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
