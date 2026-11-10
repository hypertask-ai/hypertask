const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
const jiti = createJiti(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') }, fsCache: false });
const { default: definition, HTPR_9027_AMOLED_TOGGLE_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-9027-amoled-toggle.ts'));

test('AMOLED toggle colour ships behind its own Owner + QA flag', () => {
  assert.equal(key, 'htpr-9027-amoled-toggle');
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
});
