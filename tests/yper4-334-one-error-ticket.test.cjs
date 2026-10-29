// YPER4-334: one production error gives one Bugs ticket. PostHog issue alerts
// file it; the older reporter only files when PostHog did not get the error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false });

function loadReporter({ posthogCaptured, sectionTitle = 'Bugs' }) {
  const calls = { posthog: 0, tickets: [] };
  const redis = { set: async () => 'OK', incr: async () => 1, expire: async () => 1 };
  const prisma = {
    section: { findMany: async () => [{ id: 4389, section_title: sectionTitle }] },
    label: { findFirst: async () => ({ id: 3 }) },
  };
  const stubs = {
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/lib/aiAllowancePolicy': load(path.join(root, 'src/lib/aiAllowancePolicy')),
    '@/lib/flags': {},
    '@/lib/redis': { getRedis: async () => redis },
    '@/lib/mcp/tasks/services': {
      validateProjectAccess: async () => ({ project: { uniqueIdentifier: 'HTPR', teamId: 1 } }),
      createTask: async (task) => { calls.tickets.push(task); },
    },
    '@/utils/helperFunctions/sanitizeRichHtml': load(path.join(root, 'src/utils/helperFunctions/sanitizeRichHtml')),
    './errorFingerprint': load(path.join(root, 'src/lib/errors/errorFingerprint')),
    './errorTicketThreshold': load(path.join(root, 'src/lib/errors/errorTicketThreshold')),
    './errorBoardTarget': load(path.join(root, 'src/lib/errors/errorBoardTarget')),
    './symbolicateStack': { symbolicateStack: async (stack) => ({ stack, resolvedFrames: 0 }) },
    './plainIncident.mjs': load(path.join(root, 'src/lib/errors/plainIncident.mjs')),
    '@/lib/telemetry/posthogErrorTracking': {
      capturePostHogException: async () => { calls.posthog += 1; return posthogCaptured; },
    },
  };
  const filename = path.join(root, 'src/lib/errors/reportError.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  const fakeProcess = { env: { NODE_ENV: 'production', VERCEL_ENV: 'production', ERROR_BOARD_PROJECT_ID: '15' } };
  const quietConsole = { log() {}, error() {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? require(id), process: fakeProcess, console: quietConsole, Date, Math, Number }, { filename });
  return { reportError: loaded.exports.reportError, calls };
}

const report = { message: 'yper4-334 canary', stack: 'Error: yper4-334 canary\n    at handler (route.ts:1:1)', source: 'server' };

test('an error PostHog captured files no ticket from the older reporter', async () => {
  const { reportError, calls } = loadReporter({ posthogCaptured: true });
  await reportError(report);
  assert.equal(calls.posthog, 1);
  assert.equal(calls.tickets.length, 0);
});

test('an error PostHog missed still gets one ticket from the older reporter', async () => {
  const { reportError, calls } = loadReporter({ posthogCaptured: false });
  await reportError(report);
  assert.equal(calls.posthog, 1);
  assert.equal(calls.tickets.length, 1);
  assert.equal(calls.tickets[0].projectId, 15);
});

test('an error PostHog missed reaches product intake after the Backlog rename', async () => {
  const { reportError, calls } = loadReporter({ posthogCaptured: false, sectionTitle: 'Backlog' });
  await reportError(report);
  assert.equal(calls.tickets.length, 1);
  assert.equal(calls.tickets[0].projectId, 15);
  assert.equal(calls.tickets[0].sectionId, 4389);
});
