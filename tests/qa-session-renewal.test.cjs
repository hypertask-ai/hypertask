const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function harness({ status = 200, id = 985, credentials = true } = {}) {
  const calls = [];
  const context = {
    post: async (route, options) => { calls.push({ route, options }); return { ok: () => status === 200, status: () => status }; },
    get: async (route) => { calls.push({ route }); return { status: () => 200, json: async () => ({ id }) }; },
    storageState: async (options) => calls.push({ state: options.path }),
    dispose: async () => calls.push({ disposed: true }),
  };
  const javascript = ts.transpileModule(fs.readFileSync('e2e/smoke/lib/qa-session.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'process', javascript)((name) => {
    if (name === '@playwright/test') return { request: { newContext: async (options) => { calls.push({ context: options }); return context; } } };
    if (name === 'node:fs') return { mkdirSync: () => {}, chmodSync: (_path, mode) => calls.push({ mode }) };
    return require(name);
  }, loaded, loaded.exports, { env: credentials ? { QA_LOGIN_EMAIL: 'qa@example.test', QA_LOGIN_PASSWORD: 'fixture-password' } : {} });
  return { run: () => loaded.exports.renewQaSession('https://app.hypertask.ai', '/tmp/qa-state.json'), calls };
}

test('every smoke run mints a fresh QA-only session with all server cookies, privately', async () => {
  const h = harness();
  await h.run();
  await h.run();
  assert.equal(h.calls.filter((c) => c.route === '/api/auth/qa-login').length, 2);
  assert.deepEqual(h.calls.find((c) => c.context).context, { baseURL: 'https://app.hypertask.ai' });
  assert.equal(h.calls.filter((c) => c.state).length, 2);
  assert.equal(h.calls.filter((c) => c.mode === 0o600).length, 2);
  assert.equal(h.calls.filter((c) => c.disposed).length, 2);
});

for (const options of [{ credentials: false }, { status: 401 }, { status: 404 }, { id: 6 }, { id: 2343 }]) {
  test(`renewal fails closed without saving a session: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    await assert.rejects(h.run(), /QA login/);
    assert.equal(h.calls.filter((c) => c.state).length, 0);
    if (options.credentials !== false) assert.equal(h.calls.filter((c) => c.disposed).length, 1);
  });
}
