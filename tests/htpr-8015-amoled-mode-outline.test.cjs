const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
let mode = null;
const prisma = {
  user: { findUnique: async () => ({ email: 'customer@example.test' }) },
  featureFlag: { findUnique: async () => mode ? { mode } : null },
};
const filename = path.join(root, 'src/lib/prisma.ts');
require.cache[filename] = { id: filename, filename, loaded: true, exports: { __esModule: true, default: prisma } };
const jiti = createJiti(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') }, fsCache: false });
const flags = jiti(path.join(root, 'src/lib/flags.ts'));
const { default: definition, HTPR_8015_AMOLED_MODE_OUTLINE_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-8015-amoled-mode-outline.ts'));

test('AMOLED mode outline reaches ordinary customers by default and Off disables it', async () => {
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.releaseRisk.risk, 'small');
  assert.equal(await flags.isFeatureEnabled(key, 2343), true);
  mode = 'OFF';
  assert.equal(await flags.isFeatureEnabled(key, 2343), false);
  assert.equal(await flags.isFeatureEnabled(key, 985), false);
});
