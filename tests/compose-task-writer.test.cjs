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
    if (config.response) return config.response;
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
      if (config.onCreate) await config.onCreate(body);
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

function manualImagePaste(url) {
  const { getSchema } = require('@tiptap/core');
  const { DOMParser, DOMSerializer } = require('prosemirror-model');
  const { EditorState } = require('prosemirror-state');
  const nodeView = path.join(root, 'src/components/RTE/Extensions/resizableMedia/ResizableMediaNodeView.tsx');
  require.cache[nodeView] = { id: nodeView, filename: nodeView, loaded: true, exports: { ResizableMediaNodeView: () => null } };
  const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
  const { ResizableMedia } = jiti(path.join(root, 'src/components/RTE/Extensions/resizableMedia/resizableMedia.ts'));
  const { getMediaPasteDropPlugin } = jiti(path.join(root, 'src/components/RTE/Extensions/resizableMedia/mediaPasteDropPlugin/mediaPasteDropPlugin.ts'));
  const schema = getSchema([
    require('@tiptap/extension-document').default,
    require('@tiptap/extension-paragraph').default,
    require('@tiptap/extension-text').default,
    require('@tiptap/extension-hard-break').default,
    require('@tiptap/extension-link').default.configure({ HTMLAttributes: { target: '_blank' } }),
    ResizableMedia,
  ]);
  const view = { state: EditorState.create({ schema }), dispatch(tr) { this.state = this.state.apply(tr); } };
  let prevented = false;
  const plugin = getMediaPasteDropPlugin({});
  const handled = plugin.props.handlePaste.call(plugin, view, {
    clipboardData: { items: [], files: [], getData: () => url },
    preventDefault() { prevented = true; },
  });
  assert.equal(handled, true);
  assert.equal(prevented, true);
  const dom = new JSDOM('');
  const normalize = (html) => {
    dom.window.document.body.innerHTML = html;
    const doc = DOMParser.fromSchema(schema).parse(dom.window.document.body);
    const container = dom.window.document.createElement('div');
    container.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: dom.window.document }));
    return container.innerHTML;
  };
  const container = dom.window.document.createElement('div');
  container.append(DOMSerializer.fromSchema(schema).serializeFragment(view.state.doc.content, { document: dom.window.document }));
  return { html: container.innerHTML, normalize, close: () => dom.window.close() };
}

for (const url of ['https://screencast2.com/hCUBu.png', 'https://cdn.example.com/PHOTO.JPEG?version=2&size=large#preview']) {
  test(`compose saves the same link and image as manual paste: ${url}`, async () => {
    await withWriter({ html: '<h1 id="ai-generated-task-title">Screenshot</h1><p>[[HT_MEDIA_1]]</p>' }, async ({ createComposedTask, project, writes, creates }) => {
      const manual = manualImagePaste(url);
      try {
        const result = await createComposedTask({ text: url, files: [], project, userId: 985, unfurlImageUrls: true });
        assert.equal(result.writerFailed, false);
        assert.equal(writes[0].body.taskDescription, '<p>[[HT_MEDIA_1]]</p>');
        assert.equal(manual.normalize(creates[0].description), manual.html);
        assert.match(creates[0].description, /<a [^>]*href=/);
        assert.match(creates[0].description, /<br><img /);
      } finally { manual.close(); }
    });
  });
}

test('compose fallback retains the unfurled image URL and uploaded images use distinct tokens', async () => {
  for (const writerThrows of [false, true]) {
    await withWriter({ writerThrows }, async ({ createComposedTask, project, creates, writes }) => {
      const url = 'https://screencast2.com/hCUBu.png';
      const result = await createComposedTask({ text: url, files: [{ name: 'attached.png', type: 'image/png' }], project, userId: 985, unfurlImageUrls: true });
      assert.equal(result.writerFailed, writerThrows);
      const body = new JSDOM(creates[0].description);
      try {
        assert.equal(body.window.document.querySelector('a').href, url);
        assert.deepEqual([...body.window.document.querySelectorAll('img')].map((image) => image.src), [url, 'https://files.hypertask.app/attached.png']);
        assert.equal(writes[0].body.taskDescription, '<p>[[HT_MEDIA_1]]</p><p>[[HT_MEDIA_2]]</p>');
      } finally { body.window.close(); }
    });
  }
});

test('compose keeps non-image URLs as plain links and does not unfurl image URLs embedded in prose', async () => {
  for (const url of ['https://example.com/docs', 'https://example.com/file.heic', 'https://example.com/page?image=photo.png']) {
    const html = `<p><a href="${url}">${url}</a></p>`;
    await withWriter({ html: `<h1 id="ai-generated-task-title">Reference</h1>${html}` }, async ({ createComposedTask, project, creates, writes }) => {
      await createComposedTask({ text: url, files: [], project, userId: 985, unfurlImageUrls: true });
      assert.equal(creates[0].description, html);
      assert.equal(writes[0].body.taskDescription, `<p>${url}</p>`);
    });
  }
  await withWriter({ writerThrows: true }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'Use https://example.com/photo.png as context', files: [], project, userId: 985, unfurlImageUrls: true });
    assert.equal(creates[0].description, '<p>Use https://example.com/photo.png as context</p>');
  });
});

test('with the HTPR-7051 bugfix flag off, compose keeps the pasted image URL as plain text', async () => {
  const url = 'https://screencast2.com/hCUBu.png';
  await withWriter({ html: `<h1 id="ai-generated-task-title">Screenshot</h1><p>${url}</p>` }, async ({ createComposedTask, project, writes, creates }) => {
    await createComposedTask({ text: url, files: [], project, userId: 985 });
    assert.equal(writes[0].body.taskDescription, `<p>${url}</p>`);
    assert.doesNotMatch(creates[0].description, /<img /);
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
    const filled = 'I filled in QASA-44 from your note. Want me to refine it? I can tighten the title, add acceptance criteria or split it into sub-tasks.';
    assert.equal(composeTaskAssistantMessage('QASA-44', false, true), filled);
    const fallback = '\n\nThe task writer was unavailable, so I kept your original text as the title and description.';
    assert.equal(composeTaskAssistantMessage('QASA-44', true, true), filled + fallback);
    assert.equal(composeTaskAssistantMessage('QASA-44', true), composeTaskAssistantMessage('QASA-44') + fallback);
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
    '@/lib/api/task-writes/route': { withTaskWriteFlag: (handler) => handler },
    '@/lib/api/task-writes/create-global-effects': {},
    '@/lib/ai/composeTaskTarget': createJiti(__filename)(path.join(root, 'src/lib/ai/composeTaskTarget.ts')),
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

test('standalone dictation improvement never prefixes undefined and disabled mics leave Search keys alone', async () => {
  const ts = require('typescript');
  const file = ts.createSourceFile('audio.tsx', require('node:fs').readFileSync(path.join(root, 'src/components/RTE/Components/AudioButton.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let htmlContent, textContent, improveBlock, keyHandler;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(file);
      if (name === 'htmlContent') htmlContent = node.initializer.getText(file);
      if (name === 'textContent') textContent = node.initializer.getText(file);
      if (name === 'handleKeydown') keyHandler = node.initializer.getText(file);
    }
    if (ts.isIfStatement(node) && node.expression.getText(file) === 'shouldImprove.current') improveBlock = node.thenStatement.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(htmlContent && textContent && improveBlock && keyHandler);
  const delivered = [];
  const improve = new Function('editor', 'defaultContent', 'response', 'canDeliver', 'callbackHandler', `return async () => { const htmlContent = ${htmlContent}; const textContent = ${textContent}; ${improveBlock} };`)(null, 'Typed note', { json: async () => ({ response_html: '<p>Spoken note</p>' }) }, () => true, (...args) => delivered.push(args));
  await improve();
  assert.deepEqual(delivered, [['<p>Spoken note</p>', true]]);
  for (const disabled of [false, true]) {
    const stops = [];
    const javascript = ts.transpileModule(`const handler = ${keyHandler};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const handler = new Function('disabled', 'recordingRef', 'stopRecording', `${javascript}; return handler;`)(disabled, { current: true }, (send) => stops.push(send));
    let prevented = false;
    handler({ key: 'Enter', keyCode: 13, preventDefault: () => { prevented = true; } });
    assert.deepEqual(stops, disabled ? [] : [true]);
    assert.equal(prevented, !disabled);
  }
});

test('empty task detection rejects named tasks, meaningful text and media with positive empty controls', () => {
  const { isEmptyComposeTarget } = createJiti(__filename)(path.join(root, 'src/lib/ai/composeTaskTarget.ts'));
  for (const title of ['', 'Enter task title here', 'New Task']) {
    for (const description of [null, '', ' \n\t', '<p></p>', '<p>&nbsp;</p>', '<p>&#160;</p>', '<p><strong> </strong></p>', '<p>&nb<b></b>sp;</p>']) assert.equal(isEmptyComposeTarget({ title, description }), true);
    for (const description of ['Written', '<p>Written</p>', '<p>&amp;</p>', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<p><img src="x"></p>', '<video></video>', '<audio></audio>', '<iframe></iframe>', '<embed>', '<hr>']) assert.equal(isEmptyComposeTarget({ title, description }), false);
  }
  assert.equal(isEmptyComposeTarget({ title: 'Real ticket', description: '' }), false);
});

test('existing target is forwarded to both writer and save with no new column/ranking; attachments remain linked', async () => {
  await withWriter({}, async ({ createComposedTask, defaults, project, writes, creates, linked }) => {
    const file = { name: 'screen.png', type: 'image/png' };
    await createComposedTask({ text: 'Fill this task', files: [file], project, userId: 985, existingTaskId: 52 });
    assert.deepEqual(defaults, []);
    assert.equal(writes[0].body.existingTaskId, 52);
    assert.equal(creates[0].existingTaskId, 52);
    assert.equal(creates[0].sectionId, undefined);
    assert.equal(creates[0].ranking, undefined);
    assert.equal(linked.length, 1);
    assert.deepEqual(linked[0].files, [file]);
  });
});

test('document attachments stay links rather than broken images and are still bound to the ticket', async () => {
  await withWriter({ writerThrows: true }, async ({ createComposedTask, project, creates, writes, linked }) => {
    const file = { name: 'brief.txt', type: 'text/plain' };
    await createComposedTask({ text: 'Use the brief', files: [file], project, userId: 985 });
    assert.deepEqual(writes[0].body.images64, []);
    assert.match(creates[0].description, /<a href="https:\/\/files.hypertask.app\/brief.txt">brief.txt<\/a>/);
    assert.doesNotMatch(creates[0].description, /<img/);
    assert.deepEqual(linked[0].files, [file]);
  });
});

test('save existing target enforces both flags, edit permissions, board match and empty state before normal update controller', async () => {
  const newFlag = 'htpr-6937-new-task-window';
  const { isEmptyComposeTarget } = createJiti(__filename)(path.join(root, 'src/lib/ai/composeTaskTarget.ts'));
  let compose = true, newWindow = false, authorized = true, target = null;
  const taskReads = [], updates = [], broadcasts = [], flags = [];
  const stubs = {
    '@/lib/api/task-writes/route': { withTaskWriteFlag: (handler) => handler },
    '@/lib/api/task-writes/create-global-effects': {},
    '@/lib/ai/composeTaskTarget': { isEmptyComposeTarget },
    '@/lib/flags': { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: flag, HTPR_6937_NEW_TASK_WINDOW_FLAG: newFlag,
      isFeatureEnabled: async (key) => { flags.push(key); return key === flag ? compose : newWindow; } },
    '@/lib/prisma': { __esModule: true, default: {
      user: { findUnique: async () => ({ id: 985 }) },
      project: { findFirst: async () => authorized ? { id: 7 } : null },
      task: { findFirst: async (query) => { taskReads.push(query); return target; } },
    } },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 985 }) },
    '@/lib/auth/session': { SESSION_COOKIE: 'session', verifySession: () => null },
    '@/lib/auth/resolveActingAgent': { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    '@/utils/controllers/projects/getAllIncludes': { taskWriteAccessWhere: (userId, agentId) => ({ canWrite: { userId, agentId } }) },
    '@/utils/controllers/tasks/single': { updateTaskSingle: async (...args) => { updates.push(args); return { status: 200, json: { ...target, title: args[0].title, id: args[0].id } }; } },
    '@/lib/realtime/server': { broadcastBoardChange: async (...args) => broadcasts.push(args), broadcastTaskChange: async (...args) => broadcasts.push(args) },
    '@prisma/client': {}, '@/utils/generateRank': {}, '@vercel/functions': {},
    '@/utils/controllers/tasks/getNextUniqueTaskIndex': {}, '@/lib/mcp/webhooks/taskEvents': {},
    '@/lib/mcp/webhooks/outbox': {}, '@/lib/agentWebhooks/outbox': {}, '@/utils/controllers/activities/createAssignedActivity': {},
  };
  const code = require('typescript').transpileModule(require('node:fs').readFileSync(path.join(root, 'src/pages/api/tasks/createGlobally.ts'), 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: require('typescript').ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request) => {
    assert.ok(request in stubs, `Unexpected dependency: ${request}`);
    return stubs[request];
  });
  const post = async (extra = {}) => {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await mod.exports.default({ method: 'POST', headers: {}, cookies: {}, body: {
      title: 'Written title', description: '<p>Written body</p>', projectId: 7, userId: 985, requestKind: 'compose-task', existingTaskId: 52, ...extra,
    } }, res);
    return res;
  };
  assert.equal((await post()).code, 403);
  assert.deepEqual(flags, [flag, newFlag]);
  assert.equal(taskReads.length, 0);
  compose = false; newWindow = true;
  assert.equal((await post()).code, 403);
  assert.equal(taskReads.length, 0);
  compose = true; authorized = false;
  assert.equal((await post()).code, 403);
  assert.equal(taskReads.length, 0);
  authorized = true;
  assert.equal((await post()).code, 403, 'inaccessible/cross-board task is rejected');
  assert.deepEqual(taskReads.at(-1).where, { id: 52, projectId: 7, status: 'Normal', project: { canWrite: { userId: 985, agentId: null } } });
  target = { id: 52, title: 'Already filled', projectId: 7, description_: { content: '<p>Existing</p>' } };
  assert.equal((await post()).code, 409);
  assert.equal(updates.length, 0);
  assert.equal((await post({ existingTaskId: -1 })).code, 400);
  target = { id: 52, title: 'Enter task title here', projectId: 7, status: 'Normal', uniqueIndex: 4, description_: { content: '' } };
  const result = await post();
  assert.equal(result.code, 200);
  assert.equal(result.body.newTask.id, 52);
  assert.deepEqual(updates[0][0], { id: 52, title: 'Written title', description: '<p>Written body</p>' });
  assert.equal(updates[0][1].id, 985);
  assert.deepEqual(updates[0][3], { expectedTitle: target.title, expectedDescription: '', expectedProjectId: 7, expectedStatus: 'Normal' });
  assert.equal(broadcasts.length, 2);
});

test('writer existing-task requests gate new flag and task edit scope before any AI or board retrieval', async () => {
  const cached = new Map(Object.entries(require.cache));
  const newFlag = 'htpr-6937-new-task-window';
  let compose = true, newWindow = false, target = null;
  const taskQueries = []; let boardReads = 0;
  const source = (file, exports) => {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  try {
    source('src/lib/flags.ts', { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: flag, HTPR_6937_NEW_TASK_WINDOW_FLAG: newFlag,
      isFeatureEnabled: async (key) => key === flag ? compose : newWindow });
    source('src/lib/prisma.ts', { default: {
      task: { findFirst: async (query) => { taskQueries.push(query); return target; } },
      project: { findFirst: async () => { boardReads++; return null; } },
    } });
    for (const file of ['src/app/api/ai/_lib/editorAi.ts', 'src/app/api/ai/_lib/currentTaskContext.ts', 'src/app/api/ai/_lib/providerGate.ts', 'src/app/api/ai/_lib/skills.ts', 'src/utils/controllers/turbopuffer/turbopufferHelper.ts']) source(file, {});
    source('src/utils/controllers/projects/getAllIncludes.ts', { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: (userId, agentId) => ({ writer: userId, agentId }) });
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
    const { prepareTaskWriterRun, taskWriterRequestSchema, AiFeatureDisabledError, ProjectAccessError } = jiti(path.join(root, 'src/app/api/ai/_lib/taskWriterRun.ts'));
    const body = taskWriterRequestSchema.parse({ projectId: 7, PROMPT: 'note', requestKind: 'compose-task', existingTaskId: 52 });
    await assert.rejects(prepareTaskWriterRun(body, 985), AiFeatureDisabledError);
    assert.equal(taskQueries.length, 0);
    compose = false; newWindow = true;
    await assert.rejects(prepareTaskWriterRun(body, 985), AiFeatureDisabledError);
    assert.equal(taskQueries.length, 0);
    compose = true;
    await assert.rejects(prepareTaskWriterRun(body, 985), ProjectAccessError);
    assert.deepEqual(taskQueries[0].where, { id: 52, projectId: 7, status: 'Normal', project: { writer: 985, agentId: undefined } });
    assert.equal(boardReads, 0);
    target = { title: '', description_: { content: '' } };
    await assert.rejects(prepareTaskWriterRun(body, 985), ProjectAccessError);
    assert.equal(boardReads, 1, 'an editable empty task still takes the normal board gate');
    await assert.rejects(prepareTaskWriterRun({ ...body, requestKind: 'manual' }, 985), AiFeatureDisabledError);
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
  }
});

test('progress follows response headers and first output; Saving waits for the complete writer stream', async () => {
  let headers, stream, saveFinished, saveStarted;
  const response = new Promise((resolve) => { headers = resolve; });
  const saving = new Promise((resolve) => { saveStarted = resolve; });
  const save = new Promise((resolve) => { saveFinished = resolve; });
  const stages = [];
  let stageChanged;
  const nextStage = () => new Promise((resolve) => { stageChanged = resolve; });
  const onProgress = (stage) => { stages.push(stage); stageChanged?.(); };
  await withWriter({ response, onCreate: async () => { saveStarted(); await save; } }, async ({ createComposedTask, project, creates }) => {
    let changed = nextStage();
    const task = createComposedTask({ text: 'Fix spacing', files: [], project, userId: 985, onProgress });
    await changed;
    assert.deepEqual(stages, ['Reading past tickets']);
    assert.equal(creates.length, 0);
    changed = nextStage();
    headers(new Response(new ReadableStream({ start(controller) { stream = controller; } })));
    await changed;
    assert.deepEqual(stages, ['Reading past tickets', 'Understanding the context']);
    assert.equal(creates.length, 0);
    changed = nextStage();
    stream.enqueue(new TextEncoder().encode('<h1 id="ai-generated-task-title">Fix spacing</h1>'));
    await changed;
    assert.equal(stages.at(-1), 'Writing the ticket');
    assert.equal(creates.length, 0, 'partial model output must not start saving');
    const body = new TextEncoder().encode('<p>Keep café spacing.</p>');
    const split = body.indexOf(0xc3) + 1;
    stream.enqueue(body.slice(0, split));
    stream.enqueue(body.slice(split));
    stream.close();
    await saving;
    assert.deepEqual(stages, ['Reading past tickets', 'Understanding the context', 'Writing the ticket', 'Saving the ticket']);
    assert.equal(creates.length, 1, 'Saving coincides with the real save request');
    assert.equal(creates[0].description, '<p>Keep café spacing.</p>');
    saveFinished();
    assert.equal((await task).writerFailed, false);
  });
});

for (const interrupted of [false, true]) {
  test(`progress stream failure keeps the raw-note fallback and then saves: interrupted=${interrupted}`, async () => {
    const stages = [];
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('<h1 id="ai-generated-task-title">Partial</h1>'));
      if (interrupted) controller.error(new Error('Disconnected'));
      else {
        controller.enqueue(new TextEncoder().encode('\nevent: error\ndata: {"content":"failed"}\n\nevent: done\n'));
        controller.close();
      }
    } }));
    await withWriter({ response, onCreate: () => assert.equal(stages.at(-1), 'Saving the ticket') }, async ({ createComposedTask, project, creates }) => {
      const result = await createComposedTask({ text: 'Keep the raw note', files: [], project, userId: 985, onProgress: (stage) => stages.push(stage) });
      assert.equal(result.writerFailed, true);
      assert.equal(creates[0].title, 'Keep the raw note');
      assert.equal(creates[0].description, '<p>Keep the raw note</p>');
      assert.equal(stages.at(-1), 'Saving the ticket');
    });
  });
}

test('without a progress callback the legacy response.text path stays unchanged', async () => {
  let textReads = 0;
  const response = { ok: true, get body() { throw new Error('Legacy must not read the stream directly'); }, text: async () => { textReads++; return '<h1 id="ai-generated-task-title">Legacy</h1><p>Body</p>'; } };
  await withWriter({ response }, async ({ createComposedTask, project, creates }) => {
    assert.equal((await createComposedTask({ text: 'Legacy', files: [], project, userId: 985 })).writerFailed, false);
    assert.equal(textReads, 1);
    assert.equal(creates[0].description, '<p>Body</p>');
  });
});

test('an error-only stream never claims that the model is writing', async () => {
  const stages = [];
  const response = new Response(new ReadableStream({ start(controller) {
    for (const chunk of ['ev', 'ent: error\ndata: {"content":"failed"}\n\n', 'event: done\n']) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }));
  await withWriter({ response }, async ({ createComposedTask, project }) => {
    const result = await createComposedTask({ text: 'Original note', files: [], project, userId: 985, onProgress: (stage) => stages.push(stage) });
    assert.equal(result.writerFailed, true);
    assert.deepEqual(stages, ['Reading past tickets', 'Understanding the context', 'Saving the ticket']);
  });
});
