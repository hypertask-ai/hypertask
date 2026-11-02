const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

function harness({ enabled = true, settings = {}, pin = null } = {}) {
  const calls = [];
  const { loadTurnModel } = load('src/lib/ai/chatStream/turnModel.ts', {
    '@/lib/ai/teamAiFunding': require('./helpers/team-ai-funding-stub.cjs'),
    '@/lib/prisma': { default: {
      chatSession: { findFirst: async () => null },
      userSetting: { findUnique: async () => null },
    } },
    '@/lib/ai/htpr7038ModelReset': { ensureHtpr7038ModelReset: async () => {} },
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'htpr-7796-disabled-provider-pick' ? enabled : true },
    '@/app/api/ai/_lib/modelProvider': {
      isCustomEndpointConfig: () => false,
      isVercelAiGatewayKey: () => false,
      aiUsageProviderForCredential: () => 'fixture',
      resolveAiModel: (_provider, model) => { calls.push(model); return { modelId: model }; },
      providerOptionsForAiModel: () => ({}),
    },
    '@/app/api/ai/_lib/chatTeamContext': {
      resolveChatTeamContext: async () => ({ teamId: 'fixture-team', projectId: 10, aiProviderSettings: settings }),
      buildChatProviderContext: () => ({ planGateProjectId: 10, keyLookupContext: { userId: 985, trustedTeamId: 'fixture-team' } }),
    },
    '@/app/api/ai/_lib/planGate': {
      storePlanIdForProject: async () => 'Pro',
      haiku55ModelEnabled: async () => true,
      assertModelAllowedForPlan: async () => {},
    },
    '@/app/api/ai/_lib/byokKeys': {
      getAiDefaultModelContext: async () => ({ hasByok: false, haikuDefaultEnabled: true }),
      getByokOrTeamGatewayApiKeyForModelOption: async () => undefined,
      getByokOrTeamGatewayApiKeyForProvider: async () => undefined,
      getTeamGatewayApiKey: async () => undefined,
    },
    '@/lib/ai/chatStream/prompt': { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ['claude-haiku-5'] },
    '@/lib/ai/chatStream/errors': {
      createSseErrorResponse: (message, status) => new Response(message, { status: status ?? 200 }),
      reportHandledChatError: async () => {},
      errorMessage: (error) => error.message,
    },
    '@/lib/ai/tools/helpers': { loadActingAgent: async () => pin ? { id: 'fixture-agent', modelOptionId: pin } : null },
  });
  return {
    calls,
    turn: (body) => loadTurnModel({ message: 'Hello', aiFeature: 'aiChat', ...body }, { id: 985, email: 'qa@example.test' }),
  };
}

for (const body of [
  { modelOptionId: 'deepseek-v4.1-flash-fast', modelFromDefault: false },
  { model: 'deepseek-v4.1-flash-fast' },
  { modelOptionId: 'deepseek-v4.1-flash' },
]) {
  test(`disabled explicit pick refuses without starting a model: ${JSON.stringify(body)}`, async () => {
    const h = harness();
    const result = await h.turn(body);
    assert.ok(result instanceof Response);
    assert.equal(result.status, 403);
    assert.equal(await result.text(), 'DeepSeek is off for this team. Enable it in Settings > AI models > Providers.');
    assert.deepEqual(h.calls, []);
  });
}

test('enabled explicit pick keeps the requested model', async () => {
  const h = harness({ settings: { providers: { deepseek: true } } });
  const result = await h.turn({ modelOptionId: 'deepseek-v4.1-flash-fast', modelFromDefault: false });
  assert.equal(result.streamModelOption.id, 'deepseek-v4.1-flash-fast');
  assert.deepEqual(h.calls, ['deepseek/deepseek-v4.1-flash-1017-fast']);
});

test('a disabled provider in the browser default still falls back', async () => {
  const h = harness();
  const result = await h.turn({ modelOptionId: 'deepseek-v4.1-flash-fast', modelFromDefault: true });
  assert.equal(result.streamModelOption.modelKey, 'claude-haiku-5-5');
  assert.equal(h.calls.length, 1);
});

test('a server default without a model still works', async () => {
  const h = harness();
  const result = await h.turn({ modelFromDefault: true });
  assert.equal(result.streamModelOption.modelKey, 'claude-haiku-5-5');
  assert.equal(h.calls.length, 1);
});

test('an inherited agent pin still falls back instead of refusing', async () => {
  const h = harness({ pin: 'deepseek-v4.1-flash-fast' });
  const result = await h.turn({});
  assert.equal(result.streamModelOption.modelKey, 'claude-haiku-5-5');
  assert.equal(h.calls.length, 1);
});

test('flag off preserves the existing explicit-pick fallback', async () => {
  const h = harness({ enabled: false });
  const result = await h.turn({ modelOptionId: 'deepseek-v4.1-flash-fast', modelFromDefault: false });
  assert.equal(result.streamModelOption.modelKey, 'claude-haiku-5-5');
  assert.equal(h.calls.length, 1);
});

test('GDPR safe mode still refuses an explicitly enabled China provider', async () => {
  const h = harness({ settings: { gdprSafeMode: true, providers: { deepseek: true } } });
  const result = await h.turn({ modelOptionId: 'deepseek-v4.1-flash-fast', modelFromDefault: false });
  assert.equal(result.status, 403);
  assert.match(await result.text(), /DeepSeek is off/);
  assert.deepEqual(h.calls, []);
});

test('raw OpenRouter picks name the disabled provider without running a model', async () => {
  const h = harness();
  const result = await h.turn({ provider: 'openrouter', model: 'vendor/custom-model', modelFromDefault: false });
  assert.equal(result.status, 403);
  assert.match(await result.text(), /OpenRouter is off/);
  assert.deepEqual(h.calls, []);
});

test('the rollback flag ships as an Everyone bugfix', () => {
  const flag = load('src/lib/flags/definitions/htpr-7796-disabled-provider-pick.ts', {}).default;
  assert.equal(flag.key, 'htpr-7796-disabled-provider-pick');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.kind, 'bugfix');
});
