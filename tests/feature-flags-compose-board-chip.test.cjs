const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
let mode = null;
const prisma = {
  user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? 'valentin.yeo@gmail.com' : where.id === 985 ? 'valentin@hypertask.ai' : 'other@example.test' }) },
  featureFlag: { findUnique: async () => mode ? { mode } : null },
};
const filename = path.join(root, 'src/lib/prisma.ts');
require.cache[filename] = { id: filename, filename, loaded: true, exports: { __esModule: true, default: prisma } };
const jiti = createJiti(__filename, { interopDefault: true, alias: { '@': path.join(root, 'src') }, fsCache: false });
const flags = jiti(path.join(root, 'src/lib/flags.ts'));
const definition = jiti(path.join(root, 'src/lib/flags/definitions/htpr-7053-compose-board-chip.ts')).default;

test('compose board chip is a per-file feature defaulting to Everyone, with release risk and OFF support', async () => {
  assert.equal(flags.HTPR_7053_COMPOSE_BOARD_CHIP_FLAG, 'htpr-7053-compose-board-chip');
  assert.equal(definition.key, flags.HTPR_7053_COMPOSE_BOARD_CHIP_FLAG);
  assert.equal(definition.kind, 'feature');
  assert.equal(definition.defaultMode, undefined);
  assert.deepEqual(await Promise.all([6, 985, 7].map(id => flags.isFeatureEnabled(definition.key, id))), [true, true, true]);
  assert.equal(definition.releaseRisk.risk, 'new');
  assert.ok(definition.releaseRisk.reason.length > 0);
  mode = 'OFF';
  assert.equal(await flags.isFeatureEnabled(definition.key, 985), false);
  assert.equal(await flags.isFeatureEnabled(definition.key, 6), false);
});
