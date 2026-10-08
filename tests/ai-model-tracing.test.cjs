const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { wrapLanguageModel } = require('ai');
const root = path.resolve(__dirname, '..');
const load = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false });
const registry = load(path.join(root, 'src/lib/ai/prompts/registry.ts'));
const { SharedAiAllowanceExceededError, sharedAiAllowanceErrorMessage, modelCostUsd } = load(path.join(root, 'src/app/api/ai/_lib/sharedAllowance.ts'));
const { isHaiku55Model } = load(path.join(root, 'src/lib/aiModelOptions.ts'));

function harness({ rejectTelemetry = false, rejectPricing = false, observationSink } = {}) {
  const rows = [], captures = [], errors = [], pending = [], allowances = [];
  const usage = { inputTokens: { total: 100 }, outputTokens: { total: 20 } };
  const result = { content: [{ type: 'text', text: 'private reply' }], usage, finishReason: { unified: 'stop', raw: 'end_turn' } };
  const factory = (provider) => (modelId) => ({ specificationVersion: 'v4', provider, modelId, supportedUrls: {}, doGenerate: async () => result });
  const stubs = {
    '@vercel/functions': { waitUntil: (promise) => pending.push(promise) },
    './aiUsage': { logAiUsage: async (row) => { rows.push(row); if (rejectTelemetry) throw new Error('database unavailable'); } },
    '@/lib/ai/prompts/registry': registry,
    '@/lib/telemetry/aiChatObservability': { recordAiChatTurn: async (row) => { captures.push(row); if (rejectTelemetry) throw new Error('capture unavailable'); await observationSink?.(row); } },
    '@/lib/errors/reportError': { reportError: async (report) => { errors.push(report); if (rejectTelemetry) throw new Error('tracker unavailable'); } },
    '@ai-sdk/anthropic': { createAnthropic: () => factory('anthropic') },
    '@ai-sdk/openai': { createOpenAI: () => Object.assign(factory('openai'), { chat: factory('openai') }) },
    '@openrouter/ai-sdk-provider': { createOpenRouter: () => factory('openrouter') },
    ai: { ...require('ai'), createGateway: () => factory('gateway') },
    '@/app/api/ai/_lib/sharedAllowance': {
      sharedAiAllowanceErrorMessage,
      modelCostUsd,
      gatewayCatalogModelSlug: (id) => id,
      createSharedAllowanceMiddleware: (args) => { allowances.push(args); return { specificationVersion: 'v4' }; },
      modelPricing: async () => { if (rejectPricing) throw new Error('unknown price'); return { inputUsdPerToken: 0.000003, outputUsdPerToken: 0.000015 }; },
    },
    '@/lib/aiModelOptions': { getAiModelDefinition: () => undefined, isHaiku55Model },
    '@/lib/flags/keys': { HTPR_7010_HAIKU_5_5_FLAG: 'htpr-7010-haiku-5-5' },
    '@/lib/aiProviders': { getAiProviderInfo: () => ({ openAiCompatibleBaseUrl: 'https://example.test/v1' }) },
    '@/lib/aiAllowancePolicy': { FREE_TEAM_AI_ALLOWANCE_USD: 1, PAID_TEAM_AI_ALLOWANCE_USD: 5 },
    '@/lib/aiUsageClassification': { isSystemAiFeature: (feature) => feature === 'summary', INCLUDED_WITH_HYPERTASK_GATEWAY_TAG: 'system' },
    '@/lib/ai/customEndpoint': { isCustomEndpointConfig: (value) => typeof value === 'object', normalizeCustomEndpointConfig: (value) => value },
  };
  const filename = path.join(root, 'src/app/api/ai/_lib/modelProvider.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: (id) => stubs[id] ?? require(id), process, performance, setTimeout, clearTimeout, ReadableStream, console }, { filename });
  return { api: loadedModule.exports, rows, captures, errors, allowances, usage, result, flush: async () => { await Promise.all(pending.splice(0)); } };
}

const params = { prompt: [{ role: 'system', content: registry.renderPrompt('task-summaries-system-2') }, { role: 'user', content: [{ type: 'text', text: 'private prompt' }] }] };

test('all provider branches and gateway resolver are obligatorily traced without changing model ids or allowances', async () => {
  const h = harness();
  for (const provider of ['claude', 'openai', 'openrouter', 'gateway', 'custom']) {
    const credential = provider === 'custom' ? { apiKey: 'fixture', baseUrl: 'https://example.test/v1', modelId: 'custom-test' } : provider === 'gateway' ? 'vck_fixture' : 'fixture';
    const model = h.api.resolveAiModel(provider, 'claude-sonnet-5.5', credential);
    h.api.gatewayProviderOptionsForModel(model, 'summary', { userId: 42, teamId: 'team-test', taskId: 99, agentId: 'agent-test' });
    assert.equal(await model.doGenerate(params), h.result);
  }
  const gateway = h.api.resolveGatewayModel('anthropic/claude-opus-5.5', 'vck_fixture');
  await gateway.doGenerate(params);
  await h.flush();
  assert.equal(h.rows.length, 6);
  assert.equal(h.captures.length, 6);
  assert.equal(h.errors.length, 0);
  assert.equal(h.allowances.length, 0, 'customer gateway must remain outside shared allowance');
  for (const row of h.rows.slice(0, 5)) {
    assert.equal(row.userId, 42);
    assert.equal(row.taskId, 99);
    assert.equal(row.agentId, 'agent-test');
    assert.equal(row.promptId, 'task-summaries-system-2');
    assert.equal(row.promptVersion, '1');
    assert.ok(row.latencyMs >= 0);
    assert.equal(row.totalTokens, 120);
    assert.equal(row.model, row.provider === 'byok:custom' ? 'custom-test' : 'claude-sonnet-5.5');
    if (row.provider === 'byok:custom') assert.equal(row.costUsd, null);
    else assert.ok(Math.abs(row.costUsd - 0.0006) < 1e-12);
  }
  assert.equal(h.rows[5].userId, null);
  assert.equal(h.rows[5].model, 'anthropic/claude-opus-5.5');
  assert.ok(!JSON.stringify([h.rows, h.captures, h.errors]).includes('private'));
});

test('failures, successful retries and unknown costs each produce a metadata-only attempt', async () => {
  const h = harness({ rejectPricing: true });
  const middleware = h.api.createUsageTracingMiddleware({ userId: 7, provider: 'claude', feature: 'chat' }, 'claude-sonnet-5.5');
  const error = new Error('private prompt and reply echoed by provider');
  await assert.rejects(middleware.wrapGenerate({ params, doGenerate: async () => { throw error; } }), (actual) => actual === error);
  assert.equal(await middleware.wrapGenerate({ params, doGenerate: async () => h.result }), h.result);
  await h.flush();
  assert.deepEqual(h.rows.map((row) => row.outcome), ['failed', 'ok']);
  assert.equal(h.rows[0].costUsd, 0);
  assert.equal(h.rows[1].costUsd, null);
  assert.equal(h.errors.length, 1);
  assert.ok(!JSON.stringify([h.rows, h.captures, h.errors]).includes('private'));
  assert.notEqual(h.rows[0].traceId, h.rows[1].traceId);
});

test('allowance stops retain attempt metadata without reporting inference incidents', async () => {
  for (const method of ['wrapGenerate', 'wrapStream']) {
    for (const wrapped of [false, true]) {
      const h = harness();
      const middleware = h.api.createUsageTracingMiddleware({ userId: 7, provider: 'gateway', feature: 'chat' }, 'openai/gpt-6-luna');
      const allowance = new SharedAiAllowanceExceededError('2026-10');
      const error = wrapped ? new Error('retry exhausted', { cause: allowance }) : allowance;
      const invoke = async () => { throw error; };
      await assert.rejects(middleware[method]({ params, doGenerate: invoke, doStream: invoke }), (actual) => actual === error);
      await h.flush();
      assert.equal(h.errors.length, 0);
      assert.equal(h.rows.length, 1);
      assert.equal(h.captures.length, 1);
      assert.equal(h.rows[0].userId, 7);
      assert.equal(h.rows[0].outcome, 'failed');
      assert.equal(h.rows[0].totalTokens, 0);
      assert.equal(h.rows[0].costUsd, 0);
    }
  }
});

test('stream preserves every chunk and records exactly one finish despite close and cancellation', async () => {
  const h = harness();
  const middleware = h.api.createUsageTracingMiddleware({ userId: 7, provider: 'claude' }, 'claude-sonnet-5.5');
  const chunks = [{ type: 'text-delta', delta: 'private reply' }, { type: 'finish', usage: h.usage, finishReason: { unified: 'stop' } }];
  const original = { stream: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }), request: { body: 'private request' } };
  const result = await middleware.wrapStream({ params, doStream: async () => original });
  assert.equal(result.request, original.request);
  const actual = [];
  for await (const chunk of result.stream) actual.push(chunk);
  await h.flush();
  assert.deepEqual(actual, chunks);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].totalTokens, 120);
  assert.equal(h.rows[0].outcome, 'ok');
  assert.ok(!JSON.stringify(h.rows).includes('private'));
});

test('stream errors, rejected readers, early closure, start failure and user cancellation settle exactly once', async () => {
  for (const scenario of ['chunk-error', 'read-error', 'close', 'start-error', 'cancel']) {
    const h = harness();
    const middleware = h.api.createUsageTracingMiddleware({}, 'claude-sonnet-5.5');
    const error = new Error('private provider payload');
    const doStream = async () => {
      if (scenario === 'start-error') throw error;
      return { stream: new ReadableStream({ start(controller) {
        if (scenario === 'chunk-error') { controller.enqueue({ type: 'error', error }); controller.close(); }
        if (scenario === 'read-error') controller.error(error);
        if (scenario === 'close') controller.close();
      } }) };
    };
    try {
      const result = await middleware.wrapStream({ params, doStream });
      if (scenario === 'cancel') await result.stream.cancel();
      else for await (const _chunk of result.stream) { /* Drain the isolated stream. */ }
    } catch (actual) { assert.equal(actual, error); }
    await h.flush();
    assert.equal(h.rows.length, 1, scenario);
    assert.equal(h.rows[0].outcome, scenario === 'cancel' ? 'cancelled' : 'failed');
    assert.ok(!JSON.stringify([h.rows, h.captures, h.errors]).includes('private'));
  }
});

test('an error followed by finish retains billed tokens and never becomes a successful generation', async () => {
  const h = harness();
  const middleware = h.api.createUsageTracingMiddleware({ provider: 'claude' }, 'claude-sonnet-5.5');
  const chunks = [{ type: 'error', error: new Error('private reply') }, { type: 'finish', usage: h.usage, finishReason: { unified: 'stop' } }];
  const result = await middleware.wrapStream({ params, doStream: async () => ({ stream: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }) }) });
  for await (const _chunk of result.stream) { /* Drain the isolated stream. */ }
  await h.flush();
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].outcome, 'failed');
  assert.equal(h.rows[0].totalTokens, 120);
});

test('telemetry failures do not change model results and fallback wrappers retain attribution', async () => {
  const h = harness({ rejectTelemetry: true });
  const original = h.api.resolveAiModel('claude', 'claude-sonnet-5.5', 'fixture');
  const outer = wrapLanguageModel({ model: original, middleware: { specificationVersion: 'v4' } });
  h.api.inheritAiModelUsage(outer, original);
  h.api.configureAiModelUsage(outer, { userId: 9, taskId: 100 });
  const fallback = h.api.resolveAiModel('claude', 'claude-sonnet-5', 'fixture');
  h.api.inheritAiModelUsage(fallback, outer);
  assert.equal(await fallback.doGenerate(params), h.result);
  await h.flush();
  assert.equal(h.rows[0].userId, 9);
  assert.equal(h.rows[0].taskId, 100);
  assert.equal(h.rows[0].model, 'claude-sonnet-5');
});

test('generation metadata reaches the existing PostHog sink while chat outcomes remain separate events', async () => {
  const sent = [];
  const filename = path.join(root, 'src/lib/telemetry/aiChatObservability.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  const stubs = {
    'posthog-node': { PostHog: class { async captureImmediate(capture) { sent.push(capture); } } },
    '@/lib/telemetry/errorSanitization': load(path.join(root, 'src/lib/telemetry/errorSanitization.ts')),
  };
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: (id) => stubs[id] ?? require(id), process: { env: { VERCEL_ENV: 'production', POSTHOG_SERVER_PROJECT_TOKEN: 'fixture' } }, console }, { filename });
  const h = harness({ observationSink: loadedModule.exports.recordAiChatTurn });
  const model = h.api.resolveAiModel('claude', 'claude-sonnet-5.5', 'fixture');
  h.api.configureAiModelUsage(model, { userId: 42, taskId: 99, feature: 'summary' });
  await model.doGenerate(params);
  await h.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, '$ai_generation');
  assert.equal(sent[0].distinctId, '42');
  const properties = sent[0].properties;
  assert.equal(properties.ht_feature, 'summary');
  assert.equal(properties.ht_task_id, 99);
  assert.equal(properties.ht_prompt_id, 'task-summaries-system-2');
  assert.equal(properties.ht_prompt_version, '1');
  assert.equal(properties.$ai_trace_id, h.rows[0].traceId);
  assert.equal(properties.$ai_total_cost_usd, h.rows[0].costUsd);
  assert.equal(properties.$ai_latency, h.rows[0].latencyMs / 1000);
  assert.equal(properties.$ai_input_tokens, 100);
  assert.equal(properties.$ai_output_tokens, 20);
  await loadedModule.exports.recordAiChatTurn({ ...h.captures[0], userId: null, costUsd: null, event: 'ai_chat_turn' });
  assert.equal(sent[1].event, 'ai_chat_turn');
  assert.equal(sent[1].distinctId, 'ai-system');
  assert.equal(sent[1].properties.$ai_total_cost_usd, undefined);
  assert.match(fs.readFileSync(path.join(root, 'src/lib/ai/chatStream/runStream.ts'), 'utf8'), /event: "ai_chat_turn"/);
  assert.ok(!JSON.stringify(sent).includes('private'));
});

test('migration is additive and retains historical usage rows', () => {
  const migration = fs.readFileSync(path.join(root, 'src/prisma/migrations/20261004065050_add_ai_generation_metadata/migration.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'src/prisma/schema.prisma'), 'utf8');
  assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN)|DELETE|TRUNCATE|UPDATE|NOT NULL DEFAULT/);
  for (const field of ['costUsd', 'latencyMs', 'promptId', 'promptVersion', 'outcome', 'traceId']) assert.ok(migration.includes(`ADD COLUMN "${field}"`));
  assert.match(schema, /costUsd\s+Float\?/);
  assert.match(schema, /latencyMs\s+Int\?/);
});
