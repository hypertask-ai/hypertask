const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: load } = require('./helpers/loadModule.cjs');

test('mobile writer repair is an Everyone bugfix with a ticket-specific rollback switch', () => {
  const { default: definition, HTPR_8028_MOBILE_WRITER_SAVE_FLAG: key } = load('src/lib/flags/definitions/htpr-8028-mobile-writer-save.ts');
  assert.equal(key, 'htpr-8028-mobile-writer-save');
  assert.equal(definition.key, key);
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.releaseRisk.risk, 'small');
  assert.ok(definition.releaseRisk.reason.length > 0);
});
