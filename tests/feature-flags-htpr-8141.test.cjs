const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-8141 board tooltip is a reversible low-risk improvement for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8141-board-shortcut-tooltip.ts');
  assert.equal(flag.key, 'htpr-8141-board-shortcut-tooltip');
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});
