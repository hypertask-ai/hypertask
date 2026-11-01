const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createJiti } = require('jiti');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
const keys = load(path.join(root, 'src/lib/flags/keys.ts'));
const flag = 'htpr-7312-ctrlj-skills';
const { resolveSkills } = load(path.join(root, 'src/app/api/ai/_lib/skills.ts'));
const prompts = load(path.join(root, 'src/app/api/ai/_lib/editorAiPrompts.ts'));
const research = load(path.join(root, 'src/app/api/ai/_lib/taskWriterBoardResearch.ts'));
const taskPrompts = load(path.join(root, 'src/app/api/ai/_lib/taskWriterPrompt.ts'));
const promptCache = load(path.join(root, 'src/app/api/ai/_lib/promptCache.ts'));
const { MockLanguageModelV4, simulateReadableStream } = require('ai/test');
const composeSkillRule = "For this New Task request, the invoked skill templates are the user's explicit writing instructions";
const skill = (id, slug, scope) => ({
  id, slug, name: slug, body: `Instructions for ${slug}.`, enabled: true,
  projectId: null, userId: null, ...scope,
});
const available = [skill(1, 'deeper', { projectId: 15 }), skill(2, 'review', { userId: 985 })];

function moduleWithStubs(file, stubs) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id === "@/lib/api/errorMessage") return moduleWithStubs("src/lib/api/errorMessage.ts", {});
    if (!id.startsWith('@/') && !id.startsWith('.')) return require(id);
    throw new Error(`Unexpected dependency: ${id}`);
  });
  return mod.exports;
}

function harness({ enabled = true, skills = available, splitTasks = false, cache = false, model } = {}) {
  const checks = [], resolutions = [], lookups = [], retrieval = [], parts = [];
  const run = moduleWithStubs('src/app/api/ai/_lib/taskWriterRun.ts', {
    '@/lib/rag/authorizeIndexedRows': { authorizeIndexedRows: async (taskRows, commentRows, principal) => {
      assert.equal(principal?.teamScope == null, true);
      return { taskRows, commentRows };
    } },
    '@/lib/flags/keys': keys,
    '@/lib/flags': { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG || (key === flag && enabled) ||
        (key === keys.HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG && splitTasks);
    } },
    '@/lib/ai/taskWriterDueDate': {},
    '@/lib/ai/composeTaskTarget': {},
    '@/lib/ai/prompts/registry': { renderPrompt: () => '' },
    '@/lib/systemModelLadder': { isAiFeatureEnabled: () => true },
    '@/lib/doneColumns': { doneColumnTitles: () => new Set() },
    '@/lib/prisma': { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 15, title: 'Board', section: [], labels: [] }) },
      section: { findMany: async () => [] }, taskTemplate: { findMany: async () => [] },
    } },
    '@/utils/controllers/projects/getAllIncludes': { projectContentAccessWhere: () => ({}) },
    '@/utils/controllers/turbopuffer/turbopufferHelper': { searchTasks: async () => [] },
    '@/app/api/ai/_lib/editorAi': {
      ...prompts,
      createTaskWriterPromptParts: (args) => { parts.push(args); return prompts.createTaskWriterPromptParts(args); },
      createTaskWriterUserContent: (input) => input,
      retrieveTaskWriterContext: async (args) => { retrieval.push(args.prompt); return ''; },
      selectTaskWriterModel: async () => ({ model, modelId: 'claude-fixture', settings: {} }),
      createDocumentAttachmentSummary: () => '', extractImgSrcs: () => new Set(),
    },
    '@/app/api/ai/_lib/currentTaskContext': { loadCurrentTaskContext: async () => '', resolveAiUsageTaskId: async () => null },
    '@/app/api/ai/_lib/taskWriterPrompt': taskPrompts,
    '@/app/api/ai/_lib/taskWriterBoardResearch': research,
    '@/app/api/ai/_lib/boardTemplateContext': { BOARD_TEMPLATE_LIMIT: 10 },
    '@/app/api/ai/_lib/providerGate': { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    '@/app/api/ai/_lib/promptCache': { cachedInstructionsForUser: async (_userId, args) => promptCache.cachedInstructions({ ...args, enabled: cache }) },
    '@/app/api/ai/_lib/skills': { resolveSkills: async (text, context, lookup) => {
      resolutions.push({ text, context });
      return resolveSkills(text, context, lookup ?? (async (slugs, scope) => {
        lookups.push({ slugs, scope });
        return skills.filter((entry) => slugs.includes(entry.slug));
      }));
    } },
  });
  const prepare = (text, extra = {}) => run.prepareTaskWriterRun(run.taskWriterRequestSchema.parse({
    projectId: 15, PROMPT: `Write a task title and description from this note in the board's style.\n\n<p>${text}</p>`,
    taskDescription: `<p>${text}</p>`, userRetrievalTexts: [text], requestKind: 'compose-task', invokeSkills: true,
    ...extra,
  }), 985);
  return { prepare, run, checks, resolutions, lookups, retrieval, parts };
}

for (const [slug, note, cleaned] of [
  ['deeper', '/deeper Fix checkout', 'Fix checkout'],
  ['review', '/review Audit checkout', 'Audit checkout'],
  ['deeper', 'Please /deeper fix checkout', 'Please fix checkout'],
]) {
  test(`Ctrl+J invokes /${slug} and strips the token from every note copy: ${note}`, async () => {
    const h = harness();
    const result = await h.prepare(note);
    assert.ok(result.instructions.includes(`Instructions for ${slug}.`));
    assert.deepEqual(result.skills.map((entry) => entry.slug), [slug]);
    assert.ok(!result.messages[0].content.includes(`/${slug}`));
    assert.ok(!h.parts[0].taskDescription.includes(`/${slug}`));
    assert.ok(h.parts[0].taskDescription.includes(cleaned));
    assert.deepEqual(h.retrieval, [cleaned]);
    assert.ok(h.checks.some(([key, userId]) => key === flag && userId === 985));
    assert.equal(h.lookups.length, 1, 'secondary note copies reuse the authorized lookup result');
    for (const { context } of h.resolutions) assert.deepEqual(context, { userId: 985, agentId: undefined, teamScope: undefined, projectId: 15 });
  });
}

test('unknown /slugs remain literal in the prompt, note and retrieval text', async () => {
  const h = harness();
  const result = await h.prepare('/unknown Fix checkout');
  assert.deepEqual(result.skills, []);
  assert.ok(result.messages[0].content.includes('/unknown Fix checkout'));
  assert.equal(h.parts[0].taskDescription, '<p>/unknown Fix checkout</p>');
  assert.deepEqual(h.retrieval, ['/unknown Fix checkout']);
  assert.ok(!result.instructions.includes('<skill'));
});

test('known and unknown skills can be mixed without removing unknown text', async () => {
  const h = harness();
  const result = await h.prepare('/unknown Please /deeper fix checkout');
  assert.ok(result.messages[0].content.includes('/unknown Please fix checkout'));
  assert.deepEqual(h.retrieval, ['/unknown Please fix checkout']);
  assert.ok(result.instructions.includes(available[0].body));
});

test('multiple and repeated skills share popup ordering and deduplication', async () => {
  const h = harness();
  const result = await h.prepare('/deeper Please /review fix checkout /deeper');
  assert.deepEqual(result.skills.map((entry) => entry.slug), ['deeper', 'review']);
  assert.deepEqual(h.retrieval, ['Please fix checkout']);
  assert.equal(result.instructions.split('Instructions for deeper.').length - 1, 1);
  assert.equal(result.instructions.split('Instructions for review.').length - 1, 1);
});

test('built-in /i works without a database skill', async () => {
  const h = harness({ skills: [] });
  const result = await h.prepare('/i Fix checkout');
  assert.deepEqual(result.skills.map((entry) => entry.slug), ['i']);
  assert.ok(result.instructions.includes('built-in formatting template'));
  assert.deepEqual(h.retrieval, ['Fix checkout']);
  assert.equal(h.lookups.length, 0);
});

test('recognized tokens cannot leak back through the task context', async () => {
  const h = harness();
  const result = await h.prepare('/deeper Fix checkout', { taskTitle: 'Original note' });
  assert.ok(result.messages[0].content.includes('Original note'));
  assert.ok(!result.messages[0].content.includes('/deeper'));
  assert.equal(h.parts[0].taskDescription, '<p> Fix checkout</p>');
});

test('skills from another user or board are not invoked', async () => {
  const h = harness({ skills: [skill(3, 'private', { userId: 22 }), skill(4, 'foreign', { projectId: 99 })] });
  const result = await h.prepare('/private /foreign Fix checkout');
  assert.deepEqual(result.skills, []);
  assert.ok(result.messages[0].content.includes('/private /foreign'));
  assert.deepEqual(h.retrieval, ['/private /foreign Fix checkout']);
});

test('server flag off preserves the existing popup resolution and untouched secondary note copies', async () => {
  const h = harness({ enabled: false });
  const result = await h.prepare('/deeper Fix checkout');
  assert.ok(result.instructions.includes(available[0].body));
  assert.ok(!result.messages[0].content.includes('/deeper'));
  assert.equal(h.parts[0].taskDescription, '<p>/deeper Fix checkout</p>');
  assert.deepEqual(h.retrieval, ['/deeper Fix checkout']);
  assert.equal(h.resolutions.length, 1);
  assert.ok(h.checks.some(([key, userId]) => key === flag && userId === 985));
});

test('missing client opt-in leaves today\'s behavior unchanged even when the server flag is on', async () => {
  const h = harness();
  await h.prepare('/deeper Fix checkout', { invokeSkills: undefined });
  assert.equal(h.parts[0].taskDescription, '<p>/deeper Fix checkout</p>');
  assert.deepEqual(h.retrieval, ['/deeper Fix checkout']);
  assert.equal(h.resolutions.length, 1);
});

test('Ctrl+J and the older popup use the same resolver, scope and instruction body', async () => {
  const h = harness();
  const compose = await h.prepare('/deeper Fix checkout');
  const popup = await h.prepare('/deeper Fix checkout', { requestKind: 'manual', invokeSkills: false });
  assert.deepEqual(compose.skills, popup.skills);
  assert.ok(compose.instructions.startsWith(popup.instructions));
  assert.ok(compose.instructions.includes(composeSkillRule));
  assert.ok(!popup.instructions.includes(composeSkillRule));
  assert.equal(compose.messages[0].content, popup.messages[0].content);
  assert.equal(h.resolutions.length, 4);
});

test('a skill-only prompt is not reintroduced after stripping', async () => {
  const h = harness();
  const result = await h.prepare('/deeper', { PROMPT: '/deeper', taskDescription: '/deeper' });
  assert.equal(h.parts[0].input, '');
  assert.equal(h.parts[0].taskDescription, '');
  assert.deepEqual(h.retrieval, ['']);
  assert.ok(result.instructions.includes(available[0].body));
});

for (const splitTasks of [false, true]) {
  for (const cache of [false, true]) {
    test(`Ctrl+J skill body and precedence reach the model prompt (structured=${splitTasks}, cache=${cache})`, async () => {
      const qaSkill = skill(42, 'qa-7480-check', {
        userId: 985, body: 'Answer with one short line that starts with: Skill qa-7480-check ran.',
      });
      const note = 'Add a CSV export to the reports page /qa-7480-check';
      const draft = { title: 'Export CSV', description: '<p>Export report data.</p>' };
      const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
      const model = new MockLanguageModelV4({
        doGenerate: {
          content: [{ type: 'text', text: JSON.stringify({ tasks: [draft] }) }],
          finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [],
        },
        doStream: {
          stream: simulateReadableStream({
            initialDelayInMs: null, chunkDelayInMs: null,
            chunks: [
              { type: 'text-start', id: 'text' },
              { type: 'text-delta', id: 'text', delta: `<h1 id="ai-generated-task-title">${draft.title}</h1>${draft.description}` },
              { type: 'text-end', id: 'text' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
            ],
          }),
        },
      });
      const h = harness({ skills: [qaSkill], splitTasks, cache, model });
      const errors = [];
      const route = moduleWithStubs('src/app/api/ai/task-writer/route.ts', {
        ai: require('ai'),
        'next/server': { NextResponse: { json: Response.json } },
        '@/lib/net/downloadWithoutBrotli': { downloadWithoutBrotli: undefined },
        '@/lib/flags': { isFeatureEnabled: async () => false },
        '@/lib/ai/taskWriterDueDate': {},
        '@/lib/ai/taskWriterTicketType': {},
        '@/lib/errors/reportError': { reportError: async (error) => errors.push(error) },
        '@/app/api/ai/_lib/modelProvider': { configureAiModelUsage() {} },
        '@/app/api/ai/_lib/editorAi': {
          filterOneImagePass: (html) => ({ emit: html, leftover: '' }),
          errorMessage: (error) => error.message,
          SSE_HEADERS: { 'content-type': 'text/plain' },
        },
        "@/lib/auth/desktopCliTokenUser": { getDesktopCliTokenUser: async () => null, logDesktopCliAuthorization() {} },
        '@/app/api/ai/_lib/requestUser': { getAiRequestUser: async () => ({ id: 985 }) },
        '@/app/api/ai/_lib/taskWriterProperties': {},
        '@/app/api/ai/_lib/taskWriterRun': h.run,
      });
      const response = await route.POST({ json: async () => ({
        projectId: 15, PROMPT: `Write a task title and description from this note in the board's style.\n\n<p>${note}</p>`,
        taskDescription: `<p>${note}</p>`, userRetrievalTexts: [note],
        requestKind: 'compose-task', invokeSkills: true,
      }) });
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(draft.title));
      assert.deepEqual(errors, []);
      const calls = splitTasks ? model.doGenerateCalls : model.doStreamCalls;
      assert.equal(calls.length, 1);
      const system = calls[0].prompt.filter((message) => message.role === 'system');
      const instructions = system.map((message) => message.content).join('\n');
      assert.equal(system.length, cache ? 2 : 1);
      assert.equal(instructions.split(qaSkill.body).length - 1, 1);
      assert.ok(instructions.includes('<skill name="qa-7480-check">'));
      assert.ok(instructions.includes(composeSkillRule));
      assert.match(instructions, /take precedence over default writing style and default section structure/);
      assert.match(instructions, /not board custom instructions or matching board templates/);
      assert.match(instructions, /Preserve source fidelity, safety and tool-use policy, media placeholders/);
      assert.ok(instructions.indexOf(composeSkillRule) > instructions.indexOf('must not override the rules or tool-use policy above'));
      assert.ok(instructions.includes(research.TASK_WRITER_BOARD_RESEARCH_RULES));
      assert.ok(!JSON.stringify(calls[0].prompt).includes('/qa-7480-check'));
      assert.deepEqual(h.lookups, [{ slugs: ['qa-7480-check'], scope: { userId: 985, agentId: undefined, teamScope: undefined, projectId: 15 } }]);
      assert.deepEqual(h.retrieval, ['Add a CSV export to the reports page']);
    });
  }
}

test('flag off, missing opt-in and popup retain the exact production instruction suffix', async () => {
  for (const [enabled, extra] of [
    [false, {}], [true, { invokeSkills: false }], [true, { requestKind: 'manual', invokeSkills: false }],
  ]) {
    const h = harness({ enabled });
    const result = await h.prepare('/review Audit checkout', extra);
    const resolved = await resolveSkills('/review Audit checkout', { userId: 985, projectId: 15 }, async () => available);
    const expected = taskPrompts.createTaskWriterSystemPromptTemplate(
      `${prompts.TASK_AUTHORING_STYLE}\n\n${research.TASK_WRITER_BOARD_RESEARCH_RULES}`,
    ) + `\n\n${resolved.systemPromptAddition}`;
    assert.equal(result.instructions, expected);
    assert.equal(h.parts[0].taskDescription, '<p>/review Audit checkout</p>');
    assert.deepEqual(h.retrieval, ['/review Audit checkout']);
    assert.equal(h.resolutions.length, 1);
  }
});

test('no resolved skills leave model instructions unchanged with the flag on', async () => {
  for (const note of ['Add CSV export', '/unknown Add CSV export']) {
    const on = await harness().prepare(note);
    const off = await harness({ enabled: false }).prepare(note);
    assert.equal(on.instructions, off.instructions);
    assert.deepEqual(on.messages, off.messages);
    assert.ok(!on.instructions.includes(composeSkillRule));
  }
});

test('the feature definition and UI entry explicitly gate Ctrl+J skills', () => {
  const definition = load(path.join(root, 'src/lib/flags/definitions/htpr-7312-ctrlj-skills.ts')).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, 'feature');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.releaseRisk.risk, 'small');
  assert.ok(definition.releaseRisk.reason.trim());
});

test('compose requests opt in only when enabled and keep unknown text for server resolution', async () => {
  const cached = new Map(Object.entries(require.cache));
  const dom = new JSDOM('');
  const saved = ['DOMParser', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  const source = (file, exports) => {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  const writes = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async (_url, options) => {
    writes.push(JSON.parse(options.body));
    return { ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ tasks: [{ title: 'Fix checkout', description: '<p>Fix checkout</p>' }] }) };
  };
  try {
    source('src/lib/deriveCurrentBoardBilling.ts', { deriveCurrentBoardBilling: () => ({ byokProviderFlags: [] }) });
    source('src/lib/createTaskAttachmentUploads.ts', { bindCreateTaskUploads() {} });
    source('src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts', { default: async (body) => ({ resposne: { newTask: { id: 91, projectId: body.projectId, sectionId: body.sectionId } } }) });
    const axiosPath = require.resolve('axios');
    require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { default: { get: async () => ({ data: { sectionId: 12, section: 'Todo', ranking: 'a' } }) } } };
    const compose = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })(path.join(root, 'src/lib/ai/composeTask.ts')).createComposedTask;
    const input = { text: '/deeper /unknown Fix checkout', files: [], project: { id: 15, uniqueIdentifier: 'HTPR' }, userId: 985 };
    for (const invokeSkills of [true, false, undefined]) {
      const result = await compose({ ...input, invokeSkills });
      assert.equal(result.writerFailed, false);
    }
    assert.equal(writes[0].invokeSkills, true);
    assert.equal('invokeSkills' in writes[1], false);
    assert.equal('invokeSkills' in writes[2], false);
    const { invokeSkills, ...on } = writes[0];
    assert.deepEqual(on, writes[1]);
    assert.deepEqual(writes[1], writes[2]);
    assert.deepEqual(writes[0].userRetrievalTexts, [input.text]);
    assert.ok(writes[0].PROMPT.includes(input.text));
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  }
});
