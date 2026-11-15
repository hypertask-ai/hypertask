const assert = require('node:assert/strict');
const test = require('node:test');
const { drive } = require('../.github/scripts/pstack-verifier/drive.cjs');

test('the browser does not open a host that is not the app', async () => {
  assert.deepEqual(await drive({ parentUrl: 'http://evil.example', headUrl: 'https://evil.example', routes: ['/inbox'] }), []);
  assert.deepEqual(await drive({ parentUrl: 'https://app.hypertask.ai', headUrl: 'https://head.vercel.app', routes: ['//evil'] }), []);
  assert.deepEqual(await drive(null), []);
});
