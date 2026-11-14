const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { loadModule } = require('../tests/helpers/loadModule.cjs');
const corpus = require('../tests/fixtures/htpr-9045/labelled-notifications.json');
const pure = loadModule('src/lib/ai/jevInboxTriage.ts');
const { jevInboxTriage } = loadModule('src/lib/ai/jevInboxTriageRun.ts', {
  '@/lib/prisma': { default: { project: { findMany: async () => [{ id: 1, teamId: 'eval' }] }, team: { findUnique: async () => ({ aiProviderSettings: { providers: { openrouter: true } }, byokApiKeys: [] }) } } },
  '@/app/api/ai/_lib/byokKeys': { getTeamGatewayFunding: async () => ({ apiKey: 'fixture-managed', source: 'managed' }), isOurGatewayKey: () => true, resolveTeamByokApiKey: async () => undefined },
  '@/app/api/ai/_lib/planGate': { storePlanIdForProject: async () => 'Pro' },
});
const controller = loadModule('src/utils/controllers/notifications/inboxZero.ts', { '@/lib/prisma': { default: {} } });
const { DEFAULT_INBOX_ZERO_RULES } = loadModule('src/lib/inboxZero.ts');
const calls = [];
const fetchProvider = global.fetch;
global.fetch = async (url, options) => {
  const started = performance.now();
  const call = { status: null, elapsedMs: null, answered: 0, costUsd: null };
  calls.push(call);
  try {
    const response = await fetchProvider(url, options);
    call.status = response.status;
    const body = await response.clone().json().catch(() => null);
    call.answered = pure.parseJevTriageBatch(body, Object.keys(JSON.parse(options.body).questions).map(id => ({ id }))).filter(v => v.confidence !== null).length;
    call.costUsd = body?.usage?.cost ?? null;
    return response;
  } finally { call.elapsedMs = performance.now() - started; }
};
const item = (entry, index) => ({ id: String(index + 1), projectId: 1, kind: entry.type, title: entry.title, text: entry.message ?? entry.text });
async function measure(items) {
  const first = calls.length;
  const started = performance.now();
  const result = await jevInboxTriage({ items, userId: 42 });
  return { elapsedMs: performance.now() - started, ...result, calls: calls.slice(first) };
}
(async () => {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Real eval runs only on GitHub-hosted CI');
  assert.ok(process.env.OPENROUTER_EVAL_KEY, 'Use the approved capped test account');
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_EVAL_KEY;
  const accuracy = await measure(corpus.map(item));
  const rawNoise = new Set(accuracy.noiseIds);
  const notices = corpus.map((entry, index) => ({
    id: index + 1, taskId: index + 1, notification_inviteId: null, type: entry.type, seen: true,
    createdAt: new Date('2026-11-01'), directReply: false, fromUserId: entry.author === 'human' ? 77 : null,
    fromAgentId: entry.author === 'agent' ? 'fixture' : null, message: entry.message ?? null,
    comment: { text: entry.text, commentText: entry.text, kind: null },
    task: { title: entry.title, projectId: 1, section: 'Todo', description: '', blockerCommentId: null, waitingOnUserId: null, _count: { assignees: 0, decisionRequests: 0, comments: 0 } },
  }));
  const rules = { ...DEFAULT_INBOX_ZERO_RULES, categories: { read: false, reactions: false, ownActions: false, superseded: false, pastReminders: false } };
  const noiseIds = controller.jevTriageCandidates(notices, 42, rules.keep).filter(c => c.notificationIds.every(id => rawNoise.has(String(id)))).flatMap(c => c.notificationIds);
  const effective = controller.evaluateInboxZero(notices, 42, { ...rules, jevNotificationIds: noiseIds });
  const unsafe = effective.notificationIds.filter(id => corpus[id - 1].label === 'needs_you');
  const noise = corpus.filter(entry => entry.label === 'noise');
  const throughput = [];
  for (let repeat = 0; repeat < 5; repeat++) throughput.push(await measure(Array.from({ length: 500 }, (_, index) => item(noise[index % noise.length], index))));
  const report = {
    sha: process.env.GITHUB_SHA, model: pure.JEV_TRIAGE_MODEL_SLUG, corpusSha256: createHash('sha256').update(JSON.stringify(corpus)).digest('hex'),
    boundary: 'Real production provider runner and parser; fixture team/funding lookups. Excludes HTTP, database and browser latency. Synthetic labelled notices; throughput repeats noise notices.',
    accuracy: { ...accuracy, rawUnsafeNoise: corpus.filter((entry, index) => entry.label === 'needs_you' && rawNoise.has(String(index + 1))).length, effectiveUnsafeNoise: unsafe.length, effectiveNoise: effective.jevNoiseCount },
    throughput,
    pass: accuracy.checked === 300 && unsafe.length === 0 && effective.jevNoiseCount > 0 && throughput.every(run => run.checked === 500 && run.elapsedMs <= 1500),
  };
  fs.mkdirSync('jev-inbox-eval', { recursive: true });
  fs.writeFileSync('jev-inbox-eval/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, accuracyChecked: accuracy.checked, unsafe: unsafe.length, latencyMs: throughput.map(run => Math.round(run.elapsedMs)), completed: throughput.map(run => run.checked) }));
  assert.ok(report.pass, 'Real workload did not meet every gate; inspect the saved report');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
