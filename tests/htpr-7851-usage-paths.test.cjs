const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModule } = require('./helpers/loadModule.cjs');
const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });
const ai = require('ai');
const { MockLanguageModelV4 } = require('ai/test');
const root = path.resolve(__dirname, '..');
const userId = 985, projectId = 123, taskId = 456, teamId = 'usage-team';
const request = (body) => new Request('https://app.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function harness() {
  const rows = [], pending = [], calls = [], contexts = [], errors = [];
  const prisma = { aiUsage: { create: async ({ data }) => { rows.push(data); return data; } } };
  const stubs = {
    'next/server': { NextResponse: { json: Response.json }, NextRequest: Request },
    '@/lib/ai/teamAiFunding': require('./helpers/team-ai-funding-stub.cjs'),
    '@/lib/prisma': { default: prisma },
    '@/lib/errors/reportError': { reportError: async (error) => errors.push(error) },
    '@/lib/net/downloadWithoutBrotli': { downloadWithoutBrotli: async () => [] },
    '@/lib/net/fetchWithoutBrotli': { fetchWithoutBrotli: (...args) => h.fetch(...args) },
    '@/lib/ai/prompts/registry': { renderPrompt: () => 'private fixture prompt', identifyPrompt: () => ({}) },
    '@/lib/telemetry/aiChatObservability': { recordAiChatTurn: async () => {} },
    '@vercel/functions': { waitUntil: (promise) => pending.push(promise) },
    '@/lib/aiModelOptions': { isHaiku45Model: () => false, isHaiku55Model: () => false, resolveHaikuModelId: (id) => id, getAiModelDefinition: () => undefined },
    '@/lib/ai/customEndpoint': { isCustomEndpointConfig: () => false },
    '@/lib/aiProviders': { getAiProviderInfo: () => undefined },
    '@/lib/aiAllowancePolicy': { FREE_TEAM_AI_ALLOWANCE_USD: 2, PAID_TEAM_AI_ALLOWANCE_USD: 40 },
    '@/app/api/ai/_lib/sharedAllowance': {
      gatewayCatalogModelSlug: (id) => id, modelPricing: async () => null,
      sharedAiAllowanceErrorMessage: () => null, teamAllowanceSnapshot: async () => null,
    },
    '@/app/api/ai/_lib/allowanceRefusal': { warnIfAllowanceRefused: () => null },
    '@/app/api/ai/_lib/planGate': { backgroundClaudeModelEnabled: async () => false, haiku55ModelEnabled: async () => false, assertImageModelAllowedForPlan: async () => {} },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId }) },
    '@/lib/auth/serverUser': { getServerCookieUser: async () => ({ id: userId, accountId: 'account' }) },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
    '@/lib/configs/dictation.config': { dictationConfig: { api: { deepgram: { model: 'nova-3', endpoint: 'https://deepgram.test/listen' } } } },
    '@/lib/turbopuffer': { default: {}, turbopufferNamespaces: {} },
    '@/app/api/ai/_lib/boardMemoryContract': {},
    '@/utils/controllers/search/rankHits': {},
    '@/lib/configs/general.config': { generalConfig: { hyperAiId: 332 } },
    '@/lib/crypto/byokCipher': { decryptSecret: () => 'fixture' },
    '@/lib/slack/threadSummary': {},
    '@/lib/ai/labelClassifier': {},
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => ({ id: 789 }) },
  };
  const load = (file) => loadModule(file, stubs);
  const h = { rows, pending, calls, contexts, prisma, stubs, load, errors, fetch: async () => { throw new Error('Unexpected paid network call'); }, flush: async () => { await Promise.all(pending.splice(0)); } };
  global.fetch = (...args) => h.fetch(...args);
  return h;
}

function languageModel(h, text = '<p>Suggested reply</p>') {
  return new MockLanguageModelV4({ provider: 'gateway', modelId: 'claude-sonnet-5.5', doGenerate: async (params) => {
    h.calls.push(params);
    return { content: [{ type: 'text', text }], usage: { inputTokens: { total: 40 }, outputTokens: { total: 10 } }, finishReason: { unified: 'stop', raw: 'stop' }, warnings: [] };
  } });
}

function assertRow(h, expected) {
  assert.equal(h.rows.length, 1);
  for (const [key, value] of Object.entries(expected)) assert.equal(h.rows[0][key], value, key);
  assert.ok(!JSON.stringify(h.rows).includes('private'));
}

test('suggest-reply POST preserves HTML and model selection, persisting one attributed row', async () => {
  const h = harness();
  h.stubs.ai = { ...ai, createGateway: () => () => languageModel(h) };
  h.stubs['@/lib/flags'] = { isFeatureEnabled: async () => true };
  h.stubs['@/app/api/ai/_lib/reasoningEffort'] = h.load('src/app/api/ai/_lib/reasoningEffort.ts');
  const provider = h.load('src/app/api/ai/_lib/modelProvider.ts');
  const model = provider.resolveGatewayModel('anthropic/claude-haiku-5.5', 'vck_fixture');
  h.stubs['@/app/api/ai/_lib/modelProvider'] = provider;
  h.stubs['@/app/api/ai/_lib/editorAi'] = {
    getCurrentUserFromCookies: async () => ({ id: userId }), errorMessage: String,
    selectTaskWriterModel: async (args) => {
      assert.equal(args.feature, 'suggest-reply');
      return { model, teamId, usageProvider: 'byok:claude' };
    },
  };
  h.prisma.task = { findFirst: async () => ({ id: taskId, title: 'Reply', description: '', comments: [], assignees: [], projectId, project: { title: 'Board' } }) };
  const route = h.load('src/app/api/ai/suggest-reply/route.ts');
  const response = await route.POST(request({ taskId }));
  await h.flush();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { html: '<p>Suggested reply</p>' });
  assertRow(h, { userId, teamId, projectId, taskId, provider: 'byok:claude', feature: 'suggest-reply', totalTokens: 50 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].providerOptions.anthropic.thinking.type, 'adaptive');
  assert.equal(h.calls[0].providerOptions.anthropic.effort, 'low');
});

test('status-update POST configures its own feature without changing the status output', async () => {
  const h = harness();
  h.stubs['@/lib/auth/agentScope'] = { withAgentScopeRequest: (_, run) => run() };
  h.prisma.project = { findFirst: async () => ({ id: projectId, title: 'Board', team: { id: teamId }, section: [], owner: { id: userId }, members: [] }) };
  h.prisma.task = { findMany: async () => [] };
  h.prisma.comment = { groupBy: async () => [] };
  h.stubs['@/lib/velocity'] = { resolveVelocityRange: () => ({ key: '7d' }), velocityWindow: () => ({}), buildVelocityReport: () => ({}), velocityVerdict: () => 'No change' };
  h.stubs['@/lib/doneColumns'] = { doneColumnTitles: () => new Set(), isDoneByName: () => false };
  h.stubs['@/lib/systemModelLadder'] = { resolveSystemModel: () => ({ model: 'anthropic/claude-haiku-5.5', provider: 'gateway' }) };
  h.stubs['@/app/api/ai/_lib/byokKeys'] = { getTeamGatewayApiKey: async () => 'vck_fixture', getAiDefaultModelContext: async () => ({ haiku55Enabled: false }) };
  h.stubs.ai = { ...ai, createGateway: () => () => languageModel(h, JSON.stringify({ headline: 'Status unchanged', shipped: [], inFlight: [], risks: [] })) };
  const provider = h.load('src/app/api/ai/_lib/modelProvider.ts');
  h.stubs['@/app/api/ai/_lib/modelProvider'] = { ...provider, resolveAiModel: () => provider.resolveGatewayModel('anthropic/claude-haiku-5.5', 'vck_fixture') };
  h.stubs['@/utils/controllers/reports/reportService'] = { getReport: async () => null, createReport: async () => {}, getReportUrl: () => '/report', ReportValidationError: class extends Error {} };
  const response = await h.load('src/app/api/reports/status-update/route.ts').POST(request({ projectId }));
  assert.equal(response.status, 200);
  await h.flush();
  assertRow(h, { userId, teamId, projectId, feature: 'status-update', provider: 'gateway', totalTokens: 50 });
  assert.equal(h.calls[0].maxOutputTokens, 2800);
  assert.equal(h.calls[0].providerOptions.gateway.tags[0], 'status-update');
});

test('embedding dispatcher logs a shared fetch once, preserves vectors and never records input text', async () => {
  const h = harness();
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = 'private-embedding-key';
  h.fetch = async (_, init) => {
    h.calls.push(JSON.parse(init.body));
    return Response.json({ data: [{ index: 0, embedding: Array(1536).fill(0.5) }], usage: { prompt_tokens: 12, total_tokens: 12 } });
  };
  const { embedTexts } = h.load('src/utils/controllers/turbopuffer/turbopufferHelper.ts');
  const [a, b] = await Promise.all([embedTexts(['private text']), embedTexts(['private text'])]);
  assert.equal(a[0].length, 1536);
  assert.equal(a, b);
  assert.equal(a[0][0], 0.5);
  assert.equal(h.calls.length, 1);
  assertRow(h, { feature: 'embeddings', provider: 'gateway-embeddings', userId: null, model: 'openai/text-embedding-3-small', inputTokens: 12, totalTokens: 12, outcome: 'ok' });
  delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
});

test('embedding failure retains provider refusal and logs its dedicated funding route', async () => {
  const h = harness();
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = 'private-embedding-key';
  h.fetch = async () => new Response('Invalid key', { status: 401 });
  await assert.rejects(h.load('src/utils/controllers/turbopuffer/turbopufferHelper.ts').embedTexts(['private']), /401/);
  assertRow(h, { feature: 'embeddings', provider: 'gateway-embeddings', outcome: 'failed', costUsd: null });
  delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
});

for (const failure of [false, true]) test(`Deepgram dispatcher logs trusted attribution; failure=${failure}`, async () => {
  const h = harness();
  process.env.DEEPGRAM_API_KEY = 'private-deepgram-key';
  h.fetch = async (url, init) => {
    assert.equal(new URL(url).searchParams.get('tag'), 'team:usage-team');
    assert.equal(init.headers.Authorization, 'Token private-deepgram-key');
    return failure ? new Response('Unavailable', { status: 503 }) : Response.json({ results: { channels: [{ alternatives: [{ transcript: ' Recorded text ' }] }] } });
  };
  const run = () => h.load('src/lib/services/dictation/transcriptionProviders.ts').transcribeAudioFile('deepgram', new File(['audio'], 'a.webm'), { tags: [`team:${teamId}`], usage: { userId, teamId, projectId } });
  if (failure) await assert.rejects(run(), /Unavailable/);
  else assert.equal(await run(), 'Recorded text');
  assertRow(h, { userId, teamId, projectId, feature: 'dictation', provider: 'deepgram', model: 'nova-3', outcome: failure ? 'failed' : 'ok', costUsd: null });
  delete process.env.DEEPGRAM_API_KEY;
});

for (const failure of [false, true]) test(`demo board uses the dedicated gateway and logs inference; failure=${failure}`, async () => {
  const h = harness();
  const board = { name: 'Board', views: [1, 2, 3].map((n) => ({ title: `View ${n}`, filterType: 'priority', filterValue: String(n) })), columns: ['To Do', 'In Progress', 'Done'].map((title) => ({ title, tasks: [1, 2].map((n) => ({ title: `Task ${n}`, label: null, priority: null, dueInDays: null })) })) };
  const model = languageModel(h, JSON.stringify(board));
  if (failure) model.doGenerate = async () => { throw new ai.NoContentGeneratedError({ message: 'No fixture output' }); };
  h.stubs.ai = { ...ai, createGateway: ({ apiKey }) => { assert.equal(apiKey, 'private-demo-key'); return (id) => { assert.equal(id, 'openai/gpt-6-luna'); return model; }; } };
  h.stubs['@/lib/demo/demoAllowance'] = { demoCapsEnabled: async () => false };
  h.stubs['./demoAllowance'] = h.stubs['@/lib/demo/demoAllowance'];
  process.env.DEMO_AI_GATEWAY_API_KEY = 'private-demo-key';
  const generate = h.load('src/lib/demo/generateDemoBoard.ts').generateDemoBoard;
  if (failure) await assert.rejects(generate('private purpose', teamId));
  else assert.equal((await generate('private purpose', teamId)).name, 'Board');
  await h.flush();
  assertRow(h, { userId: null, teamId, feature: 'demo-board', provider: 'gateway-demo', model: 'openai/gpt-6-luna', outcome: failure ? 'failed' : 'ok' });
  delete process.env.DEMO_AI_GATEWAY_API_KEY;
});

for (const status of [200, 401, null]) test(`BYOK test POST records a sanitized attempt; provider status=${status}`, async () => {
  const h = harness();
  h.stubs['@/lib/flags'] = { isFeatureEnabled: async () => true };
  h.stubs['@/lib/flags/definitions/htpr-7732-baseten-byok'] = {};
  const providers = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false })(path.join(root, 'src/lib/aiProviders.ts'));
  h.stubs['@/lib/aiProviders'] = providers;
  h.stubs['./providerTest'] = { buildByokTestRequest: () => ({ url: 'https://provider.test', modelLabel: 'Fixture', modelId: 'actual-model-id', init: { method: 'POST', headers: { Authorization: 'private-key' } } }), classifyByokTestResponse: (code) => code === 200 ? 'works' : 'invalid' };
  h.stubs['@/app/api/ai/_lib/byokKeys'] = {};
  h.stubs['@/utils/controllers/teams/assertTeamByokAccess'] = { assertUserCanManageTeamByok: async () => ({ ok: true }) };
  h.stubs['@/lib/freeTier'] = { isPaidTeam: async () => true };
  h.stubs['@/lib/ai/customEndpoint'] = {};
  h.stubs['@/utils/controllers/teams/updateTeamAiSettingsAtomically'] = {};
  h.fetch = async () => { if (status === null) throw new Error('private failure'); return Response.json({ usage: { input_tokens: 8, output_tokens: 1 }, private: 'never logged' }, { status }); };
  const response = await h.load('src/app/api/settings/byok-test/route.ts').POST(request({ teamId, provider: 'claude', apiKey: 'private-key' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, status === null ? 'error' : status === 200 ? 'works' : 'invalid');
  assertRow(h, { userId, teamId, feature: 'byok-test', provider: 'byok:claude', model: 'actual-model-id', outcome: status === 200 ? 'ok' : 'failed', costUsd: null });
  if (status !== null) assert.equal(h.rows[0].totalTokens, 9);
});

for (const failed of [false, true]) test(`image POST creates comment and image attachment, logs image models once; failure=${failed}`, async () => {
  const h = harness();
  const uploads = [], comments = [], attachments = [];
  let removeImageGeneration = true;
  h.stubs['@/lib/flags'] = { isFeatureEnabled: async (key, id) => { assert.equal(key, 'htpr-7859-remove-image-generation'); assert.equal(id, userId); return removeImageGeneration; } };
  h.stubs['@/app/api/ai/_lib/editorAi'] = { getCurrentUserFromCookies: async () => ({ id: userId }), errorMessage: String };
  h.stubs['@/app/api/ai/_lib/currentTaskContext'] = { htmlToText: (text) => text };
  h.stubs['@/app/api/ai/_lib/byokKeys'] = { getTeamGatewayApiKey: async () => 'vck_fixture' };
  h.stubs['@/app/api/ai/_lib/providerGate'] = { getProjectTeamProviderContext: async () => ({ projectId, teamId, settings: {} }) };
  h.stubs['@/lib/aiProviders'] = { resolveTeamProviderEnabled: () => true };
  h.stubs['@/lib/aiModelOptions'] = { resolveAiImageModelMention: () => null };
  h.stubs['@/lib/systemModelLadder'] = { isAiFeatureEnabled: () => true, resolveImageModel: () => ({ provider: 'openai', generation: 'image', gatewayModel: 'openai/gpt-image-1' }) };
  h.stubs['@/lib/aiModelPreferences'] = { getAiModelPreferenceIds: () => ({}) };
  h.stubs['@/utils/controllers/users/fetch_preferences'] = { fetchUserPreferenceController: async () => ({ res: {} }) };
  h.stubs['@/app/api/ai/_lib/modelProvider'] = { resolveGatewayImageModel: () => ({}), gatewayProviderOptionsForModel: () => ({ gateway: { tags: ['generate-image'] } }) };
  h.stubs['@/lib/storage/uploadTaskAttachmentToS3'] = { uploadTaskAttachmentToS3: async (...args) => { uploads.push(args); return 'https://fixture.test/image.png'; } };
  h.stubs['@/utils/controllers/comments/createCommentService'] = { createCommentService: async (...args) => { comments.push(args); return { id: 789 }; } };
  h.stubs['@/utils/controllers/urls/addIntoTask'] = { default: async (...args) => { attachments.push(args); } };
  h.prisma.task = { findFirst: async () => ({ userId }) };
  h.prisma.user = { findUnique: async () => ({ id: 332 }) };
  h.stubs.ai = { generateImage: async (args) => { h.calls.push(args); if (failed) throw new Error('Provider unavailable'); return { image: { mediaType: 'image/png', base64: 'aQ==' }, usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 } }; } };
  const route = h.load('src/app/api/ai/generate-image/route.ts');
  const blocked = await route.POST(request({ projectId, taskId, text: 'private image prompt' }));
  assert.equal(blocked.status, 404);
  assert.equal(h.calls.length, 0);
  assert.equal(h.rows.length, 0);
  assert.deepEqual(uploads, []);
  assert.deepEqual(comments, []);
  assert.deepEqual(attachments, []);
  removeImageGeneration = false;
  const response = await route.POST(request({ projectId, taskId, text: 'private image prompt' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).unavailable, failed);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].maxRetries, 2);
  const imageUrl = 'https://fixture.test/image.png';
  const imageHtml = failed ? '<p>Image generation is unavailable on this plan.</p>' : `<p><img src="${imageUrl}" media-type="img" width="auto" height="320" dataalign="left" loading="lazy" style="height: 320px; width: auto"></p>`;
  assert.deepEqual(comments, [[{
    text: `<p><span data-type="mention" class="mention" data-id="User" data-label="name-${userId}" uniqueindex="" projectid="">User</span> said</p><blockquote>private image prompt</blockquote>${imageHtml}<p><em>— Image model</em></p>`,
    creatorId: 332, taskId, ownerId: userId, currentUser: { id: 332 }, accessUserId: userId,
  }]]);
  if (failed) {
    assert.deepEqual(uploads, []);
    assert.deepEqual(attachments, []);
  } else {
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0][0], Buffer.from('aQ==', 'base64'));
    assert.match(uploads[0][1], /^hyperai-image-\d+\.png$/);
    assert.equal(uploads[0][2], 'image/png');
    assert.deepEqual(attachments, [[[{
      TaskId: taskId, urlString: imageUrl, title: uploads[0][1], Attachment: true, attachmentType: 'image/png',
    }], 789, 'POST']]);
  }
  assertRow(h, { userId, teamId, projectId, taskId, feature: 'generate-image', provider: 'gateway', model: 'openai/gpt-image-1', outcome: failed ? 'failed' : 'ok' });
});

for (const status of ['failed', 'expired', 'cancelled', 'succeeded']) test(`batch collector persists ${status} items without losing instant fallback`, async () => {
  const h = harness();
  const item = { taskId, projectId, labelId: 'label', promptAtSubmit: 'label prompt', snapshotAt: new Date().toISOString(), contentHash: 'hash' };
  h.prisma.aiBatch = { findMany: async () => [{ id: 'batch', gatewayBatchId: 'provider-batch', kind: 'smart-label', teamId, userId, model: 'anthropic/claude-haiku-5.5', items: { item }, createdAt: new Date() }], update: async () => {}, updateMany: async () => ({ count: 1 }) };
  h.prisma.slackWatchedThread = { findMany: async () => [] };
  h.stubs['@/app/api/ai/_lib/byokKeys'] = { getTeamGatewayApiKey: async () => 'vck_fixture' };
  h.stubs['@/lib/ai/batch/gatewayBatch'] = { gatewayBatchState: async () => 'completed', gatewayBatchOutcomes: async () => [{ id: 'item', status, text: '[]', usage: { inputTokens: 10, outputTokens: 2 } }] };
  let fallback = 0;
  h.stubs['@/lib/ai/labelClassifier'] = { getAiActor: async () => ({}), classifyLabelItemInstantly: async () => { fallback++; }, applyAiLabelVerdict: async () => 'applied' };
  assert.equal((await h.load('src/lib/ai/batch/collectBatches.ts').collectBatches()).completed, 1);
  assertRow(h, { userId, teamId, projectId, taskId, feature: 'smart-label', provider: 'gateway-batch', outcome: status === 'succeeded' ? 'ok' : status });
  assert.equal(fallback, status === 'succeeded' ? 0 : 1);
});


test('audio-transcript POST forwards authorized account and board attribution', async () => {
  const h = harness();
  process.env.DEEPGRAM_API_KEY = 'private-deepgram-key';
  h.stubs['@/app/api/ai/_lib/editorAi'] = { errorMessage: String, SSE_HEADERS: { 'Content-Type': 'text/event-stream' } };
  h.stubs['@/app/api/ai/_lib/providerGate'] = { getProjectTeamProviderContext: async () => ({ projectId, teamId, settings: {} }) };
  h.stubs['@/lib/systemModelLadder'] = { isAiFeatureEnabled: () => true };
  h.stubs['@/lib/demo/guestGuard'] = { isGuestUserId: async () => false };
  h.stubs['@/lib/dictationProvider'] = { resolveDictationProvider: () => 'deepgram', resolveDictationLanguage: () => 'en' };
  h.prisma.userSetting = { findUnique: async () => null };
  h.fetch = async () => Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Recorded text' }] }] } });
  const response = await h.load('src/app/api/ai/audio-transcript/route.ts').POST(request({ audioFile: 'data:audio/webm;base64,YXVkaW8=', projectId }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Recorded text/);
  assertRow(h, { userId, teamId, projectId, feature: 'dictation', outcome: 'ok' });
  delete process.env.DEEPGRAM_API_KEY;
});

test('BYOK provider request keeps its real model ID apart from the display label', () => {
  const { buildByokTestRequest } = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false })(path.join(root, 'src/app/api/settings/byok-test/providerTest.ts'));
  for (const provider of ['openai', 'claude', 'gateway', 'openrouter', 'baseten', 'custom']) {
    const result = buildByokTestRequest(provider, 'private-key', { baseUrl: 'https://fixture.test/v1', modelId: 'custom-model' });
    assert.equal(result.modelId, JSON.parse(result.init.body).model);
    assert.ok(result.modelId.length > 0);
    assert.ok(!result.modelId.includes('private'));
  }
});


for (const invalid of ['count', 'dimensions']) test(`invalid embedding ${invalid} records failure while retaining billed tokens`, async () => {
  const h = harness();
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = 'private-embedding-key';
  h.fetch = async () => Response.json({ data: invalid === 'count' ? [] : [{ index: 0, embedding: [0.5] }], usage: { prompt_tokens: 12, total_tokens: 12 } });
  await assert.rejects(h.load('src/utils/controllers/turbopuffer/turbopufferHelper.ts').embedTexts(['private']), /embeddings returned/);
  assertRow(h, { feature: 'embeddings', provider: 'gateway-embeddings', outcome: 'failed', inputTokens: 12, totalTokens: 12 });
  delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
});
