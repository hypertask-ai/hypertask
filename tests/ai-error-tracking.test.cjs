const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false });
const sanitization = load(path.join(root, 'src/lib/telemetry/errorSanitization.ts'));

function isolatedModule(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: (id) => stubs[id] ?? require(id), process, console }, { filename });
  return loadedModule.exports;
}

test('client crash beacons reach reportError with redaction, caps and no forged cookie identity', async () => {
  const reports = [];
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.hypertask.ai';
  try {
    const { POST } = isolatedModule('src/app/api/client-error/route.ts', {
      'next/server': { NextResponse: class { constructor(_body, options) { this.status = options.status; } } },
      '@/lib/errors/reportError': { reportError: async (report) => reports.push(report) },
      '@/lib/telemetry/errorSanitization': sanitization,
    });
    const response = await POST({ json: async () => ({ message: 'Crash: Authorization: Bearer fixture-secret', stack: 'Error\n at app.js:1:1', url: 'https://app.hypertask.ai/detail/project-99/1?token=fixture-secret', digest: 'x'.repeat(100), source: 'errorboundary' }) });
    assert.equal(response.status, 204);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].source, 'client');
    assert.equal(reports[0].extra.digest.length, 60);
    assert.equal(reports[0].url, 'https://app.hypertask.ai/detail/project-99/1');
    assert.ok(!JSON.stringify(reports).includes('fixture-secret'));
    assert.equal('userId' in reports[0], false);
    assert.equal((await POST({ json: async () => { throw new Error('invalid JSON'); } })).status, 204);
    assert.equal(reports.length, 1);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
  }
});

test('tracker failures do not change beacon status or leak usage payloads', async () => {
  const reports = [];
  const tracker = { reportError: async (report) => { reports.push(report); throw new Error('tracker unavailable'); } };
  const { POST } = isolatedModule('src/app/api/client-error/route.ts', {
    'next/server': { NextResponse: class { constructor(_body, options) { this.status = options.status; } } },
    '@/lib/errors/reportError': tracker,
    '@/lib/telemetry/errorSanitization': sanitization,
  });
  assert.equal((await POST({ json: async () => ({ message: 'Crash' }) })).status, 204);
  const { logAiUsage } = isolatedModule('src/app/api/ai/_lib/aiUsage.ts', {
    '@/lib/prisma': { default: { aiUsage: { create: async () => { throw new Error('private prompt echoed by DB'); } } } },
    '@/lib/errors/reportError': tracker,
  });
  await logAiUsage({ userId: 7, provider: 'claude', model: 'claude-sonnet-5.5', feature: 'chat', inputTokens: 10 });
  assert.equal(reports.at(-1).message, 'AI usage persistence failed');
  assert.ok(!JSON.stringify(reports).includes('private prompt'));
});

test('chat API tracking does not persist provider-echoed prompt or reply bodies', async () => {
  const reports = [];
  const { reportHandledChatError } = isolatedModule('src/lib/ai/chatStream/errors.ts', {
    '@/lib/api/errorMessage': { toErrorMessage: () => 'private echoed prompt' },
    '@/lib/errors/reportError': { reportError: async (report) => reports.push(report) },
    '@/lib/ai/tools/constants': { SSE_HEADERS: {} },
  });
  await reportHandledChatError(Object.assign(new Error('private echoed reply'), { statusCode: 500 }), 'model-stream', { model: 'claude-sonnet-5.5' });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].message, 'AI chat request failed');
  assert.equal(reports[0].extra.statusCode, 500);
  assert.ok(!JSON.stringify(reports).includes('private echoed'));
});

test('AI API failures use existing durable tracker and existing PostHog alerting, with no new vendor', () => {
  for (const route of ['suggest-reply', 'hyper-mentioned', 'task-writer', 'task-questions', 'generate-board', 'tiptap-forwardslash', 'audio-transcript', 'generate-image']) {
    const source = fs.readFileSync(path.join(root, `src/app/api/ai/${route}/route.ts`), 'utf8');
    assert.match(source, /await reportError\(/, route);
    assert.doesNotMatch(source, /@sentry|Sentry\./);
  }
  const tracker = fs.readFileSync(path.join(root, 'src/lib/errors/reportError.ts'), 'utf8');
  assert.match(tracker, /capturePostHogException\(report\)/);
  assert.match(tracker, /reportErrorTicket\(report\)/);
  const alerts = fs.readFileSync(path.join(root, '.github/workflows/posthog-error-alert.yml'), 'utf8');
  assert.match(alerts, /workflow_dispatch/);
  assert.match(alerts, /posthog-error-alert\.mjs/);
});
