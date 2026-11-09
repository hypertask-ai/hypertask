const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-7983 guest signup holds the visible change at Owner + QA', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-7983-free-mode-signup.ts');
  assert.equal(flag.key, 'htpr-7983-free-mode-signup');
  assert.equal(flag.kind, 'feature');
  assert.equal(flag.defaultMode, 'OWNER_AND_QA');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
