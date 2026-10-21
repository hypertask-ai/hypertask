const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createJiti } = require('jiti');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

const proposed = (label, priority, size, estimate) =>
  `<p>Proposed properties: Priority <strong>${label}</strong>, Size <strong>${size}</strong>` +
  `<span id="ai-generated-task-priority" style="display:none">${priority}</span>` +
  `<span id="ai-generated-task-estimate" style="display:none">${estimate}</span></p>`;
const splitDrafts = [
  { title: 'Focus search', description: `<p>Add a shortcut.</p>${proposed('High', 2, 'S', 3)}` },
  { title: 'Export CSV', description: `<p>Export the table.</p>${proposed('Low', 4, 'L', 5)}` },
];
const jsonResponse = (tasks) => ({
  ok: true,
  headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
  text: async () => JSON.stringify({ tasks }),
});
const htmlResponse = (html) => ({ ok: true, headers: { get: () => null }, text: async () => html });

async function withComposer(response, check) {
  const cached = new Map(Object.entries(require.cache));
  const dom = new JSDOM('');
  const saved = ['DOMParser', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  const source = (file, exports) => {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  const creates = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async () => response;
  try {
    source('src/lib/deriveCurrentBoardBilling.ts', { deriveCurrentBoardBilling: () => ({ byokProviderFlags: [] }) });
    source('src/lib/createTaskAttachmentUploads.ts', {
      startCreateTaskUpload() {}, createTaskUploadById() {}, retryCreateTaskUpload() {}, bindCreateTaskUploads() {},
    });
    source('src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts', { default: async (body) => {
      creates.push(body);
      return { resposne: { newTask: { id: 90 + creates.length, uniqueIndex: creates.length, projectId: body.projectId, sectionId: body.sectionId } } };
    } });
    const axiosPath = require.resolve('axios');
    require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { default: {
      get: async () => ({ data: { sectionId: 12, section: 'Todo', ranking: 'a' } }),
    } } };
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
    const api = jiti(path.join(root, 'src/lib/ai/composeTask.ts'));
    const { PriorityConstants, EstimateConstants } = jiti(path.join(root, 'src/lib/constants/constants.ts'));
    const project = { id: 7, uniqueIdentifier: 'QASA', section: [{ id: 12, section_title: 'Todo' }] };
    const compose = (extra = {}) => api.createComposedTask({ text: 'Two tasks: focus search and export CSV', files: [], project, userId: 985, ...extra });
    await check({ compose, creates, priority: (index) => PriorityConstants.find((entry) => entry.priority_index === index), estimate: (index) => EstimateConstants.find((entry) => entry.estimate_index === index) });
  } finally {
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  }
}

test('flag on: each split ticket saves its own drafted priority and size without the Proposed properties line', async () => {
  await withComposer(jsonResponse(splitDrafts), async ({ compose, creates, priority, estimate }) => {
    const result = await compose({ applyWriterProperties: true });
    assert.equal(result.writerFailed, false);
    assert.deepEqual(creates.map((body) => [body.priority, body.estimate]), [[priority(2), estimate(3)], [priority(4), estimate(5)]]);
    assert.deepEqual(creates.map((body) => body.description), ['<p>Add a shortcut.</p>', '<p>Export the table.</p>']);
  });
});

test('flag on: the single-ticket writer path saves its drafted priority and size too', async () => {
  await withComposer(htmlResponse(`<h1 id="ai-generated-task-title">Focus search</h1><p>Add a shortcut.</p>${proposed('Urgent', 1, 'M', 4)}`), async ({ compose, creates, priority, estimate }) => {
    await compose({ applyWriterProperties: true });
    assert.equal(creates.length, 1);
    assert.equal(creates[0].priority, priority(1));
    assert.equal(creates[0].estimate, estimate(4));
    assert.doesNotMatch(creates[0].description, /Proposed properties/);
  });
});

test('flag on: explicit or view-provided priority and size win over the draft, including an explicit none', async () => {
  await withComposer(jsonResponse(splitDrafts), async ({ compose, creates, priority, estimate }) => {
    const fields = { priority: priority(0), estimate: estimate(0) };
    await compose({ applyWriterProperties: true, fields });
    for (const body of creates) {
      assert.equal(body.priority, fields.priority);
      assert.equal(body.estimate, fields.estimate);
    }
  });
});

test('flag on: drafted zero, junk or unknown markers set nothing', async () => {
  const drafts = [
    { title: 'A', description: `<p>A</p>${proposed('None', 0, 'none', 0)}` },
    { title: 'B', description: `<p>B</p>${proposed('Odd', 'high', 'odd', 99)}` },
  ];
  await withComposer(jsonResponse(drafts), async ({ compose, creates }) => {
    await compose({ applyWriterProperties: true });
    for (const body of creates) {
      assert.equal('priority' in body, false);
      assert.equal('estimate' in body, false);
    }
  });
});

test('flag on: filling an existing ticket leaves its priority and size alone, later split tickets still get theirs', async () => {
  await withComposer(jsonResponse(splitDrafts), async ({ compose, creates, priority }) => {
    await compose({ applyWriterProperties: true, existingTaskId: 55 });
    assert.equal(creates[0].existingTaskId, 55);
    assert.equal('priority' in creates[0], false);
    assert.equal('estimate' in creates[0], false);
    assert.equal(creates[1].priority, priority(4));
  });
});

test('flag off: split save payload is unchanged', async () => {
  await withComposer(jsonResponse(splitDrafts), async ({ compose, creates }) => {
    await compose();
    assert.deepEqual(creates.map((body) => body.description), splitDrafts.map((draft) => draft.description));
    for (const body of creates) {
      assert.equal('priority' in body, false);
      assert.equal('estimate' in body, false);
    }
  });
});

test('the server task-writer prompt states the same priority and size numbers the app saves', () => {
  const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false });
  const { PROMPTS } = jiti(path.join(root, 'src/lib/ai/prompts/registry.ts'));
  const { PriorityConstants, EstimateConstants } = jiti(path.join(root, 'src/lib/constants/constants.ts'));
  const prompt = PROMPTS['task-writer-prompt-context-2'].parts.join('');
  for (const { priority_index, Priority_Value } of PriorityConstants.filter((entry) => entry.priority_index > 0)) {
    assert.ok(prompt.includes(`${priority_index}=${Priority_Value}`), `prompt must say ${priority_index}=${Priority_Value}`);
  }
  for (const { estimate_index, estimate_value } of EstimateConstants.filter((entry) => entry.estimate_index > 0)) {
    assert.ok(prompt.includes(`${estimate_index}=${estimate_value}`), `prompt must say ${estimate_index}=${estimate_value}`);
  }
});
