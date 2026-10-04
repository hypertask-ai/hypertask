const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createJiti } = require('jiti');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const flag = 'htpr-6929-compose-task-writer';

async function withWriter(config, check) {
  const cached = new Map(Object.entries(require.cache));
  const dom = new JSDOM('');
  const saved = ['DOMParser', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  const source = (file, exports) => {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  const defaults = [], writes = [], creates = [], linked = [], uploaded = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async (url, options) => {
    writes.push({ url, body: JSON.parse(options.body) });
    if (config.writerThrows) throw new Error('Network unavailable');
    return { ok: config.writerOk ?? true, text: async () => config.html ?? '<h1 id="ai-generated-task-title">Fix checkout spacing</h1><p>Match the screenshot.</p>' };
  };
  try {
    source('src/lib/deriveCurrentBoardBilling.ts', { deriveCurrentBoardBilling: () => ({ byokProviderFlags: [] }) });
    source('src/lib/createTaskAttachmentUploads.ts', {
      startCreateTaskUpload(file) {
        uploaded.push(file);
        return { id: file.name, promise: config.uploadFails ? Promise.reject(new Error('Upload failed')) : Promise.resolve({ url: `https://files.hypertask.app/${file.name}` }) };
      },
      createTaskUploadById() {}, retryCreateTaskUpload() {},
      bindCreateTaskUploads(taskId, files) { linked.push({ taskId, files }); },
    });
    source('src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts', { default: async (body) => {
      creates.push(body);
      if (config.createThrows) throw new Error('Create failed');
      if (config.createFails) return { error: true };
      if (config.missingTask) return { error: false, resposne: {} };
      return { resposne: { newTask: { id: 91, uniqueIndex: 44, projectId: body.projectId, sectionId: body.sectionId, ticketNumber: 'QASA-44' } } };
    } });
    const axios = { get: async (_url, options) => { defaults.push(options.params); return { data: config.defaults ?? { sectionId: 12, section: 'Todo', ranking: 'a' } }; } };
    const axiosPath = require.resolve('axios');
    require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { default: axios } };
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
    const api = jiti(path.join(root, 'src/lib/ai/composeTask.ts'));
    const project = { id: 7, uniqueIdentifier: 'QASA', teamId: 'team-a', ai_custom_instructions: [{ customInstruction: 'Use our board template', source_selected: 'openai', model_selected: 'board-model' }] };
    await check({ ...api, defaults, writes, creates, linked, uploaded, project });
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  }
}

test('current URL board wins over previous board and stale state; other pages use previousBoard then recency', async () => {
  await withWriter({}, ({ composeTaskBoardId }) => {
    for (const url of ['/project?id=7&board=QA', '/project/7', '/project/project-7']) {
      assert.equal(composeTaskBoardId(url, 'project-8|&|doing', { 9: 20 }), 7);
    }
    for (const url of ['/settings', '/inbox', '/detail/project-55/1', '/chat', '/new']) {
      assert.equal(composeTaskBoardId(url, 'project-8|&|doing', { 9: 20 }), 8);
      assert.equal(composeTaskBoardId(url, undefined, { 7: 10, 9: 20 }), 9);
    }
    assert.equal(composeTaskBoardId('/settings', undefined, {}), undefined);
    assert.equal(composeTaskBoardId('/settings', 'garbage', { 0: 99, 7: 10 }), 7);
  });
});

test('existing task writer produces title/description with board instructions and first-column create defaults', async () => {
  await withWriter({}, async ({ createComposedTask, project, defaults, writes, creates }) => {
    const result = await createComposedTask({ text: 'Fix checkout', files: [], project, userId: 985 });
    assert.equal(result.writerFailed, false);
    assert.deepEqual(defaults, [{ projectId: 7, position: 'top' }]);
    assert.equal(writes[0].url, '/api/ai/task-writer');
    assert.equal(writes[0].body.projectId, 7);
    assert.equal(writes[0].body.teamId, 'team-a');
    assert.equal(writes[0].body.customInstructions, 'Use our board template');
    assert.equal(writes[0].body.modelSelected, 'board-model');
    assert.equal(writes[0].body.requestKind, 'compose-task');
    assert.deepEqual(writes[0].body.userRetrievalTexts, ['Fix checkout']);
    assert.equal(creates[0].title, 'Fix checkout spacing');
    assert.equal(creates[0].description, '<p>Match the screenshot.</p>');
    assert.equal(creates[0].projectId, 7);
    assert.equal(creates[0].sectionId, 12);
    assert.equal(creates[0].ranking, 'a');
    assert.equal(creates[0].requestKind, 'compose-task');
  });
});

test('images use existing uploads, writer media tokens and task attachment linking, including omitted model images', async () => {
  await withWriter({}, async ({ createComposedTask, project, writes, creates, uploaded, linked }) => {
    const image = { name: 'screenshot.png', type: 'image/png' };
    await createComposedTask({ text: 'Fix spacing', files: [image], project, userId: 985 });
    assert.deepEqual(uploaded, [image]);
    assert.deepEqual(writes[0].body.images64, [{ fileName: image.name, mimeType: image.type, url: 'https://files.hypertask.app/screenshot.png' }]);
    assert.match(writes[0].body.taskDescription, /\[\[HT_MEDIA_1\]\]/);
    assert.match(creates[0].description, /<img src="https:\/\/files.hypertask.app\/screenshot.png"/);
    assert.deepEqual(linked, [{ taskId: 91, files: [image] }]);
  });
});

for (const [label, config] of [
  ['HTTP error', { writerOk: false }], ['network failure', { writerThrows: true }],
  ['SSE error after 200', { html: '<h1 id="ai-generated-task-title">Partial</h1>\nevent: error\ndata: {"content":"failed"}\n\nevent: done\n' }],
  ['missing title', { html: '<p>Body only</p>' }], ['missing description', { html: '<h1 id="ai-generated-task-title">Title only</h1>' }],
]) {
  test(`task writer ${label} falls back to the full raw note and says so in the chat`, async () => {
    await withWriter(config, async ({ createComposedTask, composeTaskAssistantMessage, project, creates }) => {
      const text = '  Fix <login> & spacing\nKeep every line  ';
      const result = await createComposedTask({ text, files: [], project, userId: 985 });
      assert.equal(result.writerFailed, true);
      assert.equal(creates[0].title, text);
      assert.equal(creates[0].description, '<p>  Fix &lt;login&gt; &amp; spacing<br>Keep every line  </p>');
      assert.match(composeTaskAssistantMessage('QASA-44', true), /task writer was unavailable.*original text as the title and description/s);
    });
  });
}

test('initial assistant greeting is exact and contains no model request', async () => {
  await withWriter({}, ({ composeTaskAssistantMessage, writes, creates }) => {
    assert.equal(composeTaskAssistantMessage('QASA-44'), 'I created QASA-44 from your note. Want me to refine it? I can tighten the title, add acceptance criteria or split it into sub-tasks.');
    assert.equal(writes.length, 0);
    assert.equal(creates.length, 0);
  });
});

for (const config of [{ createFails: true }, { createThrows: true }, { missingTask: true }]) {
  test(`create failure rejects instead of falsely navigating: ${JSON.stringify(config)}`, async () => {
    await withWriter(config, async ({ createComposedTask, project, linked }) => {
      await assert.rejects(createComposedTask({ text: 'Keep my note', files: [], project, userId: 985 }));
      assert.equal(linked.length, 0);
    });
  });
}

test('missing first column and failed uploads cannot create an incomplete task', async () => {
  for (const config of [{ defaults: {} }, { uploadFails: true }]) {
    await withWriter(config, async ({ createComposedTask, project, writes, creates }) => {
      await assert.rejects(createComposedTask({ text: 'Keep my note', files: [{ name: 'screen.png', type: 'image/png' }], project, userId: 985 }));
      assert.equal(writes.length, 0);
      assert.equal(creates.length, 0);
    });
  }
});

test('shared server writer gates compose before accessing a board; legacy writer retains its authorization path', async () => {
  const cached = new Map(Object.entries(require.cache));
  const source = (file, exports) => {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  let enabled = false, accesses = 0;
  try {
    source('src/lib/flags.ts', { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: flag, isFeatureEnabled: async (key) => key === flag && enabled });
    source('src/lib/prisma.ts', { default: { project: { findFirst: async () => { accesses++; return null; } } } });
    for (const file of ['src/app/api/ai/_lib/editorAi.ts', 'src/app/api/ai/_lib/currentTaskContext.ts', 'src/app/api/ai/_lib/providerGate.ts', 'src/app/api/ai/_lib/skills.ts', 'src/utils/controllers/turbopuffer/turbopufferHelper.ts']) source(file, {});
    source('src/utils/controllers/projects/getAllIncludes.ts', { projectContentAccessWhere: () => ({}) });
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
    const { prepareTaskWriterRun, taskWriterRequestSchema, AiFeatureDisabledError, ProjectAccessError } = jiti(path.join(root, 'src/app/api/ai/_lib/taskWriterRun.ts'));
    const body = taskWriterRequestSchema.parse({ projectId: 7, PROMPT: 'note', requestKind: 'compose-task' });
    await assert.rejects(prepareTaskWriterRun(body, 985), AiFeatureDisabledError);
    assert.equal(accesses, 0, 'flag off must short-circuit before retrieval or AI work');
    enabled = true;
    await assert.rejects(prepareTaskWriterRun(body, 985), ProjectAccessError);
    assert.equal(accesses, 1, 'flag on still enforces board membership');
    enabled = false;
    await assert.rejects(prepareTaskWriterRun({ ...body, requestKind: 'manual' }, 985), ProjectAccessError);
    assert.equal(accesses, 2, 'flag off does not change legacy writer behavior');
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
  }
});

test('actual create endpoint rejects disabled Compose before database work and preserves legacy/auth checks', async () => {
  let enabled = false, session = { userId: 985 }, flagReads = 0, userReads = 0, boardReads = 0;
  const stubs = {
    '@/lib/flags': { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: flag, isFeatureEnabled: async (key, userId) => {
      assert.equal(key, flag); assert.equal(userId, 985); flagReads++; return enabled;
    } },
    '@/lib/prisma': { __esModule: true, default: {
      user: { findUnique: async () => { userReads++; return { id: 985 }; } },
      project: { findFirst: async () => { boardReads++; return null; } },
    } },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
    '@/lib/auth/session': { SESSION_COOKIE: 'session', verifySession: () => null },
    '@/lib/auth/resolveActingAgent': { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: () => ({}) },
    '@prisma/client': {}, '@/utils/generateRank': {}, '@vercel/functions': {},
    '@/utils/controllers/tasks/getNextUniqueTaskIndex': {}, '@/lib/mcp/webhooks/taskEvents': {},
    '@/lib/mcp/webhooks/outbox': {}, '@/lib/agentWebhooks/outbox': {},
    '@/utils/controllers/activities/createAssignedActivity': {},
  };
  const code = require('typescript').transpileModule(require('node:fs').readFileSync(path.join(root, 'src/pages/api/tasks/createGlobally.ts'), 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: require('typescript').ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request) => {
    assert.ok(request in stubs, `Unexpected dependency: ${request}`);
    return stubs[request];
  });
  const post = async (body) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await mod.exports.default({ method: 'POST', headers: {}, cookies: {}, body: { title: 'Test note', projectId: 7, userId: 985, ...body } }, res);
    return res;
  };
  let result = await post({ requestKind: 'compose-task' });
  assert.equal(result.code, 403);
  assert.equal(result.body.message, 'Compose task writer is turned off');
  assert.equal(userReads, 0); assert.equal(boardReads, 0);
  result = await post({});
  assert.equal(result.code, 403);
  assert.equal(result.body.message, 'Forbidden');
  assert.equal(flagReads, 1, 'legacy create never reads the new flag');
  assert.equal(boardReads, 1);
  enabled = true;
  result = await post({ requestKind: 'compose-task' });
  assert.equal(result.code, 403);
  assert.equal(result.body.message, 'Forbidden', 'flag on still requires board access');
  assert.equal(boardReads, 2);
  result = await post({ requestKind: 'compose-task', userId: 1 });
  assert.equal(result.code, 403);
  assert.equal(flagReads, 2, 'user mismatch is rejected before flag evaluation');
  session = null;
  result = await post({ requestKind: 'compose-task' });
  assert.equal(result.code, 401);
  assert.equal(flagReads, 2, 'unauthenticated requests cannot read the flag');
});
