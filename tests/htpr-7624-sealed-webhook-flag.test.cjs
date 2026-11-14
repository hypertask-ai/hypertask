const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const key = 'htpr-7624-sealed-webhook-keys';
const migration = 'src/prisma/migrations/20261115120000_drop_htpr_7624_sealed_webhook_keys_flag/migration.sql';

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === 'index.generated.ts') return [];
    const source = fs.readFileSync(file, 'utf8');
    return source.includes(key) || source.includes('SEALED_WEBHOOK_KEYS_FLAG') ? [path.relative(root, file)] : [];
  });
}

test('sealed webhook keys stay on and the safety switch is retired', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/lib/flags/definitions', `${key}.ts`)), false);
  assert.deepEqual(sourceReferences(path.join(root, 'src')), ['src/lib/flags.ts']);
  assert.equal(fs.readFileSync(path.join(root, migration), 'utf8'), `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`);
  assert.equal(fs.existsSync(path.join(root, 'e2e/smoke/flag-modes', `${key}.json`)), false);
  const modes = JSON.parse(fs.readFileSync(path.join(root, 'e2e/smoke/production-flag-modes.json'), 'utf8'));
  assert.equal(Object.hasOwn(modes.modes, key), false);
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.crons.find(({ path }) => path === '/api/cron/webhook-signing-key-sweep').schedule, '*/10 * * * *');
});
