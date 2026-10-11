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
    const axios = { get: async (_url, options) => {
      defaults.push(options.params);
      if (options.params.sectionId !== undefined) {
        if (config.topFails) throw new Error('Defaults unavailable');
        return { data: { sectionId: options.params.sectionId, section: 'x', ranking: `top-of-${options.params.sectionId}` } };
      }
      return { data: config.defaults ?? { sectionId: 12, section: 'Todo', ranking: 'a' } };
    } };
    const axiosPath = require.resolve('axios');
    require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { default: axios } };
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
    const api = jiti(path.join(root, 'src/lib/ai/composeTask.ts'));
    const project = { id: 7, section: config.sections ?? [{ id: 12, section_title: 'Bugs' }, { id: 13, section_title: 'Improvements' }, { id: 14, section_title: 'Features' }], uniqueIdentifier: 'QASA', teamId: 'team-a', ai_custom_instructions: [{ customInstruction: 'Use our board template', source_selected: 'openai', model_selected: 'board-model' }] };
    await check({ ...api, defaults, writes, creates, linked, uploaded, project });
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  }
}

const types = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })(path.join(root, 'src/lib/ai/taskWriterTicketType.ts'));
const span = (value) => `<span id="ai-generated-task-type" style="display:none">${value}</span>`;
const typed = (value, extra = '') => ({
  ok: true,
  headers: { get: (name) => name === 'X-Task-Writer-Ticket-Type' ? 'enabled' : null },
  text: async () => `<h1 id="ai-generated-task-title">Agents react with emoji</h1><p>Agents should react.</p>${extra}${span(value)}`,
});
const viewWithStatus = { id: 7, project_view: { user_project_views: [{ unsavedView: { board_filters: { addedFilters: [{ type: 'Status', searchPayload: [] }] } } }] } };

test('type parsing: valid, missing and junk values', () => {
  assert.equal(types.parseTicketType(' Improvement '), 'improvement');
  assert.equal(types.parseTicketType('BUG'), 'bug');
  assert.equal(types.parseTicketType('feature'), 'feature');
  for (const junk of ['', 'epic', 'bug fix', undefined, null, 4, '<b>chore</b>']) assert.equal(types.parseTicketType(junk), null);
  assert.deepEqual(types.readTaskWriterTicketType(`<p>x</p>${span('feature')}`), { type: 'feature', html: '<p>x</p>' });
  assert.deepEqual(types.readTaskWriterTicketType('<p>x</p>'), { type: null, html: '<p>x</p>' });
  assert.deepEqual(types.readTaskWriterTicketType(`<p>x</p>${span('epic')}`), { type: null, html: '<p>x</p>' });
});

test('server normalizing keeps one canonical marker for a valid type and drops junk', () => {
  assert.equal(types.normalizeTaskWriterTicketType(`<p>x</p>${span('Bug')}${span('feature')}`), `<p>x</p>${span('bug')}`);
  assert.equal(types.normalizeTaskWriterTicketType(`<p>x</p>${span('chore')}`), '<p>x</p>');
  assert.equal(types.normalizeTaskWriterTicketType('<p>x</p>'), '<p>x</p>');
});

test('column mapping: match, case-insensitive, singular, no match, deleted, missing type', () => {
  const sections = [{ id: 1, section_title: 'Backlog' }, { id: 2, section_title: ' BUGS ' }, { id: 3, section_title: 'improvement' }, { id: 4, section_title: 'Features', deleted: true }];
  assert.deepEqual(types.ticketTypeSection('bug', sections), { id: 2, title: ' BUGS ' });
  assert.deepEqual(types.ticketTypeSection('improvement', sections), { id: 3, title: 'improvement' });
  assert.equal(types.ticketTypeSection('feature', sections), null);
  assert.equal(types.ticketTypeSection(null, sections), null);
  assert.equal(types.ticketTypeSection('bug', undefined), null);
});

test('compose end to end: an improvement lands in the Improvements column, not the default Bugs column', async () => {
  await withWriter({ response: typed('improvement') }, async ({ createComposedTask, project, creates, defaults }) => {
    await createComposedTask({ text: 'Agents react with emoji', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 13);
    assert.equal(creates[0].section_title, 'Improvements');
    // Same top-of-column ranking lookup the default column uses, for the typed column.
    assert.deepEqual(defaults, [{ projectId: 7, position: 'top' }, { projectId: 7, sectionId: 13, position: 'top' }]);
    assert.equal(creates[0].ranking, 'top-of-13');
    assert.equal(creates[0].description, '<p>Agents should react.</p>');
  });
});

test('compose end to end: a bug stays in Bugs and a feature goes to Features', async () => {
  await withWriter({ response: typed('bug') }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
  });
  await withWriter({ response: typed('feature') }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 14);
  });
});

test('compose keeps the default column when the board has no matching column or the type is missing or junk', async () => {
  await withWriter({ response: typed('improvement'), sections: [{ id: 12, section_title: 'Todo' }] }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
    assert.equal(creates[0].ranking, 'a');
  });
  await withWriter({ response: typed('epic') }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
    assert.equal(creates[0].description, '<p>Agents should react.</p>');
  });
  await withWriter({}, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
  });
});

test('flag off: without the marker header the span is never read and the column is today\'s default', async () => {
  const response = { ok: true, headers: { get: () => null }, text: async () => `<h1 id="ai-generated-task-title">T</h1><p>Body.</p>${span('improvement')}` };
  await withWriter({ response }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
    assert.equal(creates[0].ranking, 'a');
  });
});

test('a view Status filter is task state, not a column, so the type still picks the column', async () => {
  await withWriter({ response: typed('improvement') }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985, viewProject: viewWithStatus });
    assert.equal(creates[0].sectionId, 13);
    assert.equal(creates[0].ranking, 'top-of-13');
  });
});

test('if the top-of-column lookup fails the ticket is still created in today\'s default column', async () => {
  await withWriter({ response: typed('improvement'), topFails: true }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
    assert.equal(creates[0].ranking, 'a');
  });
});

test('an existing empty task is filled in place and never moved by the type', async () => {
  await withWriter({ response: typed('improvement') }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985, existingTaskId: 55 });
    assert.equal(creates[0].existingTaskId, 55);
    assert.notEqual(creates[0].sectionId, 13);
  });
});

test('split tasks are placed per draft by their own type', async () => {
  const body = JSON.stringify({ tasks: [
    { title: 'Fix crash', description: `<p>Crashes.</p>${span('bug')}` },
    { title: 'Add export', description: `<p>Export.</p>${span('feature')}` },
    { title: 'Tidy copy', description: `<p>Copy.</p>${span('wat')}` },
  ] });
  const response = { ok: true, headers: { get: (name) => name === 'X-Task-Writer-Ticket-Type' ? 'enabled' : name === 'content-type' ? 'application/json' : null }, body: null, text: async () => body };
  await withWriter({ response }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.deepEqual(creates.map((c) => c.sectionId), [12, 14, 12]);
    assert.deepEqual(creates.map((c) => c.description), ['<p>Crashes.</p>', '<p>Export.</p>', '<p>Copy.</p>']);
  });
});

test('malformed markers: unquoted id, self-closing, nested span and unclosed marker are all removed', () => {
  assert.deepEqual(types.readTaskWriterTicketType('<p>x</p><span id=ai-generated-task-type style="display:none">bug</span>'), { type: 'bug', html: '<p>x</p>' });
  assert.deepEqual(types.readTaskWriterTicketType("<p>x</p><span id='ai-generated-task-type'>feature</span>"), { type: 'feature', html: '<p>x</p>' });
  assert.deepEqual(types.readTaskWriterTicketType('<p>x</p><span id="ai-generated-task-type" />'), { type: null, html: '<p>x</p>' });
  assert.deepEqual(types.readTaskWriterTicketType('<p>x</p><span id="ai-generated-task-type"><span>improvement</span></span><p>y</p>'), { type: 'improvement', html: '<p>x</p><p>y</p>' });
  assert.deepEqual(types.readTaskWriterTicketType('<p>x</p><span id="ai-generated-task-type">improvement'), { type: null, html: '<p>x</p>improvement' });
  assert.equal(types.normalizeTaskWriterTicketType('<p>x</p><span id=ai-generated-task-type>Improvement</span>'), `<p>x</p>${span('improvement')}`);
});

test('safe cut holds back only a trailing marker or the start of one', () => {
  assert.equal(types.ticketTypeSafeCut('<p>hello</p>'), 12);
  assert.equal(types.ticketTypeSafeCut(`<p>hello</p>${span('bug')}`), 12);
  assert.equal(types.ticketTypeSafeCut('<p>hello</p><sp'), 12);
  assert.equal(types.ticketTypeSafeCut('<p>hello</p><'), 12);
  assert.equal(types.ticketTypeSafeCut(`<span>early</span>${'x'.repeat(400)}`), 18 + 400);
});

test('the Bugs default check: by column id, by title, and false for any other first column', () => {
  const sections = [{ id: 1, section_title: 'Backlog' }, { id: 2, section_title: 'Bug' }];
  assert.equal(types.isBugsColumn({ sectionId: 2, section: 'x' }, sections), true);
  assert.equal(types.isBugsColumn({ sectionId: 9, section: ' Bugs ' }, sections), true);
  assert.equal(types.isBugsColumn({ sectionId: 1, section: 'Bugs' }, sections), false);
  assert.equal(types.isBugsColumn(undefined, sections), false);
});

test('hidden columns are skipped like deleted ones', () => {
  const sections = [{ id: 1, section_title: 'Improvements', visibility: false }, { id: 2, section_title: 'Improvements' }];
  assert.deepEqual(types.ticketTypeSection('improvement', sections), { id: 2, title: 'Improvements' });
  assert.equal(types.ticketTypeSection('improvement', [sections[0]]), null);
});

test('compose only reroutes when the default column is Bugs; a Backlog first column keeps today\'s behaviour', async () => {
  const sections = [{ id: 12, section_title: 'Backlog' }, { id: 13, section_title: 'Improvements' }, { id: 14, section_title: 'Bugs' }];
  for (const type of ['improvement', 'bug', 'feature']) {
    await withWriter({ response: typed(type), sections, defaults: { sectionId: 12, section: 'Backlog', ranking: 'a' } }, async ({ createComposedTask, project, creates, defaults }) => {
      await createComposedTask({ text: 'x', files: [], project, userId: 985 });
      assert.equal(creates[0].sectionId, 12);
      assert.equal(creates[0].ranking, 'a');
      assert.deepEqual(defaults, [{ projectId: 7, position: 'top' }]);
    });
  }
});

test('compose skips a hidden matching column and keeps the default', async () => {
  const sections = [{ id: 12, section_title: 'Bugs' }, { id: 13, section_title: 'Improvements', visibility: false }];
  await withWriter({ response: typed('improvement'), sections }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.equal(creates[0].sectionId, 12);
  });
});

test('split drafts have every writer marker removed from the saved description, even malformed ones', async () => {
  const body = JSON.stringify({ tasks: [
    { title: 'A', description: '<p>One.</p><span id=ai-generated-task-type>improvement</span>' },
    { title: 'B', description: '<p>Two.</p><span id="ai-generated-task-type"><span>feature</span></span><span id="ai-generated-task-tags">t</span>' },
    { title: 'C', description: '<p>Three.</p><span id="ai-generated-task-type" />' },
  ] });
  const response = { ok: true, headers: { get: (name) => name === 'X-Task-Writer-Ticket-Type' ? 'enabled' : name === 'content-type' ? 'application/json' : null }, body: null, text: async () => body };
  await withWriter({ response }, async ({ createComposedTask, project, creates }) => {
    await createComposedTask({ text: 'x', files: [], project, userId: 985 });
    assert.deepEqual(creates.map((c) => c.description), ['<p>One.</p>', '<p>Two.</p>', '<p>Three.</p>']);
    assert.deepEqual(creates.map((c) => c.sectionId), [13, 14, 12]);
  });
});
