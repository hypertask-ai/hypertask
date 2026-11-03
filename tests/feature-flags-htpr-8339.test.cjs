const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-8339 template switch question is a reversible access bugfix', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8339-template-switch-question.ts');
  assert.equal(flag.key, 'htpr-8339-template-switch-question');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'OWNER_AND_QA');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.equal(flag.releaseRisk.highRisk, 'access');
  assert.ok(flag.releaseRisk.reason);
});
