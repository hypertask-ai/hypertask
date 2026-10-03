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

test('missing fixtures, nonterminating models and invalid thresholds fail closed', async () => {
  await assert.rejects(evaluate({ golden, fixtures: {} }), /Missing recorded turn/);
  const stale = structuredClone(require('./fixtures/ai/recorded-contract.json'));
  stale.chatPrompt = 'stale';
  await assert.rejects(evaluate({ golden, fixtures, contract: stale }), /Recorded fixtures are stale/);
  await assert.rejects(evaluate({ golden, fixtures, threshold: NaN }), /threshold/);
  const task = structuredClone(golden.tasks[0]);
  await assert.rejects(runTask(task, chatTools(), async () => fixtures[task.id][0], 2), /Step limit/);
});

test('offline mode cannot import database modules or make network calls', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(id, ...args) {
      if (id.includes('prisma') || id.includes('reportService')) throw new Error('Forbidden production dependency');
      return original.call(this, id, ...args);
    };
    assert.throws(() => require('@prisma/client'), /Forbidden production dependency/);
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

test('CI is path scoped, hosted and explicitly offline without credentials', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ai-evals.yml'), 'utf8');
  for (const directory of ['src/app/api/ai/**', 'src/lib/mcp-server/config/**', 'src/lib/mcp-server/validations/**', 'src/lib/ai/**']) assert.ok(workflow.includes(directory));
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /AI_EVAL_LIVE: "0"/);
  assert.match(workflow, /AI_EVAL_WRONG_TOOL_THRESHOLD: "0"/);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target/);
});
