const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

test('HTPR-8218 comment pin and star is a feature for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8218-comment-pin-star.ts');
  assert.equal(flag.key, 'htpr-8218-comment-pin-star');
  assert.equal(flag.kind, 'feature');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.shippedOn, '2026-10-30');
});
