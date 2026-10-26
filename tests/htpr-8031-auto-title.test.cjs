const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { load } = require('./helpers/create-view-context.cjs');
const jiti = require('jiti')(__filename, { alias: { '@': path.resolve(__dirname, '../src') }, fsCache: false });
const properties = jiti('../src/app/api/ai/_lib/taskWriterProperties.ts');
const flag = 'htpr-8031-auto-title';

async function post({ requestKind = 'auto-title', enabled = true, output = '<h1 id="ai-generated-task-title">Check the bread delivery</h1>' } = {}) {
  const route = load('src/app/api/ai/task-writer/route.ts', {
    'ai': { streamText: () => ({ textStream: (async function* () { yield output; })() }) },
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/flags': { isFeatureEnabled: async key => key === flag && enabled },
    '@/lib/flags/definitions/htpr-8031-auto-title': { HTPR_8031_AUTO_TITLE_FLAG: flag },
    '@/app/api/ai/_lib/editorAi': {
      errorMessage: error => error.message, SSE_HEADERS: {},
      sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    },
    '@/app/api/ai/_lib/taskWriterProperties': properties,
    '@/app/api/ai/_lib/modelProvider': { configureAiModelUsage() {} },
    '@/lib/ai/taskWriterDueDate': {},
    '@/lib/ai/taskWriterTicketType': {},
    '@/lib/net/downloadWithoutBrotli': {},
    '@/lib/auth/desktopCliTokenUser': { logDesktopCliAuthorization() {} },
    '@/app/api/ai/_lib/requestUser': { getAiRequestUser: async () => ({ id: 985 }) },
    '@/lib/errors/reportError': { reportError: async () => {} },
    '@/app/api/ai/_lib/taskWriterRun': {
      missingRequiredFields: () => false,
      taskWriterRequestSchema: { parse: body => body },
      prepareTaskWriterRun: async () => ({ selected: { model: {}, settings: {} }, instructions: 'unchanged', messages: [], validateDraft: true }),
    },
  });
  const response = await route.POST({ json: async () => ({ projectId: 8384, aiMode: 'AiTaskWriter', requestKind }) });
  return response.text();
}

test('automatic title accepts the existing title marker without demanding a generated description', async () => {
  assert.equal(await post(), '<h1 id="ai-generated-task-title">Check the bread delivery</h1>');
});

test('full task writer and flag-off auto-title still reject title-only drafts', async () => {
  assert.match(await post({ requestKind: 'manual' }), /empty-task-writer-draft/);
  assert.match(await post({ enabled: false }), /empty-task-writer-draft/);
  const draft = '<h1 id="ai-generated-task-title">Check delivery</h1><p>Before opening.</p>';
  assert.equal(await post({ requestKind: 'manual', output: draft }), draft);
});

test('automatic title refuses empty, metadata-only and description-only replies', async () => {
  for (const output of ['', ' ', '<p>Body but no title</p>', '<span id="ai-generated-task-priority">2</span>', '<h1 id="ai-generated-task-title"> </h1>']) {
    assert.match(await post({ output }), /empty-task-writer-draft/);
  }
});

const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { createAutoTitleGenerationCoordinator } = jiti('../src/lib/ai/autoTitleGeneration.ts');
const { extractTitleAndDescription } = jiti('../src/utils/aiWriterUtils.ts');
const { describeTaskWriterStreamFailure } = jiti('../src/utils/helperFunctions/describeTaskWriterFailure.ts');
const source = ts.createSourceFile('modal.ts', fs.readFileSync(path.resolve(__dirname, '../src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts'), 'utf8'), ts.ScriptTarget.Latest, true);

function callback(name, context) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `missing production callback ${name}`);
  const compiled = ts.transpileModule(`return (${expression.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}

function titleClient({ enabled = true, reply = '<h1 id="ai-generated-task-title">Check delivery</h1>', status = 200, fetchReply } = {}) {
  const dom = new JSDOM();
  let title = '';
  const notices = [];
  const requests = [];
  const coordinator = createAutoTitleGenerationCoordinator();
  const epoch = { current: 0 };
  const context = {
    DOMParser: dom.window.DOMParser, useCallback: fn => fn, autoTitleRecoveryEnabled: enabled,
    autoTitleCoordinator: coordinator, saveEpochRef: epoch, setIsGeneratingTitle() {}, setTitleGenerationError() {},
    applyGeneratedTitle: value => { title = value; }, toast: { error: value => notices.push(value) },
    haiku55Enabled: true, haikuDefaultEnabled: true, defaultModelOption: {}, defaultContext: undefined,
    _currentProject: { teamId: 'qa' }, formValuesRef: { current: { currentProject: { id: 8384, teamId: 'qa' } } },
    aiModelPreferencesRef: { current: {} }, getAiModelPreferenceIds: () => ({}),
    getAiModelOptionById: () => undefined, deriveCurrentBoardBilling: () => ({}),
    getDefaultAiModelOptionForPlan: () => ({ id: 'unchanged-model', source: 'claude' }), hasHaikuByokProviderFlags: () => false,
    taskWriterRoute: '/api/ai/task-writer', buildTaskWriterRequestScope: project => ({ projectId: project.id }),
    extractTitleAndDescription: html => {
      const previous = global.DOMParser;
      global.DOMParser = dom.window.DOMParser;
      try { return extractTitleAndDescription(html); } finally { global.DOMParser = previous; }
    },
    describeTaskWriterStreamFailure,
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return fetchReply ? fetchReply(options.signal) : new Response(reply, { status }); },
  };
  context.descriptionText = callback('descriptionText', context);
  context.requestTitleFromDescription = callback('requestTitleFromDescription', context);
  return { generate: callback('generateTitleFromDescription', context), coordinator, epoch, requests, notices, get title() { return title; }, close: () => dom.window.close() };
}

test('new-task title request declares its intent without changing the existing prompt or model', async () => {
  const on = titleClient(), off = titleClient({ enabled: false });
  try {
    assert.equal(await on.generate('<p>Check delivery</p>'), 'Check delivery');
    assert.equal(await off.generate('<p>Check delivery</p>'), 'Check delivery');
    assert.equal(on.requests[0].requestKind, 'auto-title');
    const { requestKind, ...sameRequest } = on.requests[0];
    assert.deepEqual(sameRequest, off.requests[0]);
    assert.equal(off.requests[0].requestKind, undefined);
  } finally { on.close(); off.close(); }
});

for (const [name, options] of [
  ['provider refusal', { status: 503, reply: 'Unavailable' }],
  ['empty stream', { reply: '' }],
  ['failed stream after a partial title', { reply: '<h1 id="ai-generated-task-title">Partial</h1>event: error\ndata: {"code":"task-writer-stream-error","content":"Unavailable"}\n\n' }],
]) {
  test(`save uses a readable bounded fallback after ${name}, without looping`, async () => {
    const client = titleClient(options);
    const description = '<p>Check &amp; confirm the morning bread delivery before opening. Bring the receipt to the bakery team.</p>';
    try {
      const expected = 'Check & confirm the morning bread delivery before opening. Bring the receipt to the bakery team.'.slice(0, 80);
      assert.equal(await client.generate(description), expected);
      assert.equal(client.title, expected);
      assert.equal(client.coordinator.needsGenerationForSave(expected, description), false);
      assert.deepEqual(client.notices, ['Couldn’t generate a title. Using your description.']);
    } finally { client.close(); }
  });
}

test('flag-off generation failure still requires a manual title', async () => {
  const client = titleClient({ enabled: false, status: 503 });
  try {
    await assert.rejects(client.generate('<p>Check delivery</p>'), /Title generation is unavailable/);
    assert.equal(client.title, '');
    assert.deepEqual(client.notices, []);
  } finally { client.close(); }
});

for (const change of ['manual', 'discard', 'description']) {
  test(`${change} while title generation fails never applies a stale fallback`, async () => {
    let reject;
    const client = titleClient({ fetchReply: () => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }) });
    try {
      const pending = client.generate('<p>Old description</p>');
      if (change === 'manual') client.coordinator.manualTitleChanged();
      else if (change === 'discard') { client.epoch.current++; client.coordinator.reset(); }
      else client.coordinator.schedule('', { generate: async () => 'unused' });
      reject(new Error('Provider failed'));
      assert.equal(await pending, null);
      assert.equal(client.title, '');
      assert.deepEqual(client.notices, []);
    } finally { client.close(); }
  });
}

test('ticket flag defaults to Everyone with bugfix release metadata', () => {
  const definition = jiti('../src/lib/flags/definitions/htpr-8031-auto-title.ts').default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.releaseRisk.risk, 'small');
});
