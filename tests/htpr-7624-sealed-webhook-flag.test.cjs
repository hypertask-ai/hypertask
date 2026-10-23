const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./task-route-loader.cjs');

test('operational sealed-write flag defaults to Owner + QA with the staged deployment and key-retention barrier', () => {
  const { default: definition, SEALED_WEBHOOK_KEYS_FLAG } = load('src/lib/flags/definitions/htpr-7624-sealed-webhook-keys.ts', {});
  assert.equal(SEALED_WEBHOOK_KEYS_FLAG, 'htpr-7624-sealed-webhook-keys');
  assert.equal(definition.key, SEALED_WEBHOOK_KEYS_FLAG);
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
  assert.equal(definition.releaseRisk.highRisk, 'access');
  assert.match(definition.releaseRisk.reason, /every web\/queue runtime and drain old workers/);
  assert.match(definition.releaseRisk.reason, /rollback floor/);
  assert.match(definition.releaseRisk.reason, /Preserve BYOK_CIPHER_SECRET/);
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.equal(vercel.crons.find(({ path }) => path === '/api/cron/webhook-signing-key-sweep').schedule, '*/10 * * * *');
});
