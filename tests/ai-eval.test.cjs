const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate, chatTools, mcpTools, validateCall, runTask } = require('../scripts/ai-eval.cjs');
const golden = require('./fixtures/ai/golden-tasks.json');
const fixtures = require('./fixtures/ai/recorded-turns.json');

test('offline golden loops exercise chat and MCP with ten tool shapes and retry/token accounting', async () => {
  const report = await evaluate({ golden, fixtures, contract: require('./fixtures/ai/recorded-contract.json') });
  assert.equal(report.mode, 'recorded');
  assert.equal(report.results.length, 5);
  assert.equal(report.wrongToolRate, 0);
  assert.equal(report.results.reduce((sum, task) => sum + task.retries, 0), 1);
  assert.ok(report.results.every((task) => task.inputTokens > 0 && task.outputTokens > 0));
  const names = new Set(report.results.flatMap((task) => task.calls.map((call) => call.name.replace('_for_task', '').replace('_to_task', ''))));
  assert.equal(names.size, 10);
});

test('wrong tool threshold fails against a schema-valid wrong selection', async () => {
  const wrong = structuredClone(fixtures);
  wrong['board-due-tasks'][0].calls[0].name = 'hypertask_list_tasks';
  wrong['board-due-tasks'][0].calls[0].arguments = { search: 'Eval' };
  const tasks = structuredClone(golden);
  delete tasks.tasks[0].arguments;
  await assert.rejects(evaluate({ golden: tasks, fixtures: wrong }), /Wrong-tool rate/);
  assert.ok((await evaluate({ golden: tasks, fixtures: wrong, threshold: 0.1 })).wrongToolRate > 0);
});

test('mocked LLM calls validate every top-ten schema for both surfaces', () => {
  const catalogs = { chat: chatTools(), mcp: mcpTools() };
  for (const task of golden.tasks) {
    for (const turn of fixtures[task.id]) {
      for (const call of turn.calls) {
        validateCall(call, catalogs[task.surface]);
        assert.throws(() => validateCall({ ...call, arguments: { ...call.arguments, hallucinated_field: true } }, catalogs[task.surface]), /Unexpected argument/);
      }
    }
  }
  assert.equal(Object.keys(catalogs.chat).length, 10);
  assert.equal(Object.keys(catalogs.mcp).length, 10);
  assert.throws(() => validateCall({ id: 'bad', name: 'hypertask_list_labels', arguments: { project_id: -1 } }, catalogs.chat));
  assert.throws(() => validateCall({ id: 'bad', name: 'unknown', arguments: {} }, catalogs.chat), /Unknown tool/);
});

test('isolated MCP metadata includes the shared Decisions guidance in the recorded comment contract', () => {
  const load = require('jiti')(__filename, { fsCache: false });
  const { DECISIONS_GUIDANCE } = load(path.join(__dirname, '../src/lib/mcp/decisionsGuidance.ts'));
  assert.ok(mcpTools().hypertask_add_comment_to_task.description.startsWith(DECISIONS_GUIDANCE + ' '));
});

test('chat create-task eval preserves the exact flag-off schema and validation', () => {
  const { z } = require('zod');
  const load = require('jiti')(__filename, { fsCache: false });
  const { createTaskItemSchema } = load(path.join(__dirname, '../src/lib/ai/tools/schemas.ts'));
  const expected = createTaskItemSchema.partial().extend({
    tasks: z.array(createTaskItemSchema).max(50).optional().describe('Tasks to create in one call. Prefer this over repeated tool calls.'),
    confirmed: z.boolean().optional().describe('Set true ONLY after the user has explicitly approved creating 4 or more tasks in their own message. Never set it to confirm your own proposal.'),
  });
  const tools = chatTools();
  const { schema, description } = tools.hypertask_create_task;
  assert.deepEqual(z.toJSONSchema(schema), z.toJSONSchema(expected));
  assert.equal(description, 'Create one or many tasks, up to 50 per call. For multiple tasks, pass tasks with each task\'s project_id and fields in one call instead of looping. Returns created tasks and per-task failures.');
  const valid = { project_id: 15, title: 'Fixture', description: 'Body', priority: 'High' };
  const validate = (input) => validateCall({ id: 'create', name: 'hypertask_create_task', arguments: input }, tools);
  validate(valid);
  validate({ tasks: [valid], confirmed: true });
  for (const invalid of [
    { ...valid, brief: 'Writer-only input' },
    { ...valid, title: '' },
    { ...valid, project_id: -1 },
    { ...valid, priority: 'Critical' },
    { tasks: [{ project_id: 15, brief: 'Missing legacy title' }] },
    { tasks: [{ ...valid, title: '' }] },
    { tasks: Array.from({ length: 51 }, () => valid) },
  ]) assert.throws(() => validate(invalid));
});

test('missing fixtures, nonterminating models and invalid thresholds fail closed', async () => {
  await assert.rejects(evaluate({ golden, fixtures: {} }), /Missing recorded turn/);
  const stale = structuredClone(require('./fixtures/ai/recorded-contract.json'));
  stale.chatPrompt = 'stale';
  await assert.rejects(evaluate({ golden, fixtures, contract: stale }), /Recorded fixtures are stale/);
  await assert.rejects(evaluate({ golden, fixtures, threshold: NaN }), /threshold/);
  const task = structuredClone(golden.tasks[0]);
  await assert.rejects(runTask(task, chatTools(), async () => fixtures[task.id][0], 2), /Step limit/);
});

test('offline mode can load generated enums but cannot import database services or make network calls', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._resolveFilename;
    Module._resolveFilename = function(id, ...args) {
      if (id.includes('reportService') || id.includes('@prisma/adapter-pg') || id.endsWith('/lib/prisma') || id.endsWith('/lib/prisma.ts')) throw new Error('Forbidden production dependency');
      return original.call(this, id, ...args);
    };
    assert.throws(() => require('@prisma/adapter-pg'), /Forbidden production dependency/);
    assert.throws(() => require('./src/lib/prisma.ts'), /Forbidden production dependency/);
    assert.ok(require('@prisma/client').SortingMode);
    global.fetch = async () => { throw new Error('Offline network call'); };
    const { evaluate } = require('./scripts/ai-eval.cjs');
    evaluate({ golden: require('./tests/fixtures/ai/golden-tasks.json'), fixtures: require('./tests/fixtures/ai/recorded-turns.json') })
      .then(() => console.log('isolated offline eval passed')).catch(() => { process.exitCode = 1; });
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /isolated offline eval passed/);
});

test('live adapter uses synthetic tools and bounded loops without storing model text', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const golden = require('./tests/fixtures/ai/golden-tasks.json');
    const fixtures = require('./tests/fixtures/ai/recorded-turns.json');
    const steps = new Map();
    process.env.ANTHROPIC_API_KEY = 'fixture';
    global.fetch = async (url, request) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      const body = JSON.parse(request.body);
      const task = golden.tasks.find(task => task.request === body.messages[0].content);
      assert.ok(task && body.tools.length === 10 && body.system.length > 0);
      const step = steps.get(task.id) ?? 0;
      steps.set(task.id, step + 1);
      const turn = fixtures[task.id][step];
      return { ok: true, json: async () => ({ content: turn.calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })), usage: { input_tokens: turn.inputTokens, output_tokens: turn.outputTokens } }) };
    };
    require('./scripts/ai-eval.cjs').evaluate({ golden, fixtures, live: true }).then(report => {
      assert.equal(report.mode, 'live');
      assert.equal(report.wrongToolRate, 0);
      console.log('mocked live eval passed');
    }).catch(() => { process.exitCode = 1; });
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mocked live eval passed/);
});

