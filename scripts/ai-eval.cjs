const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { z } = require('zod');

const root = path.resolve(__dirname, '..');
const load = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false });
const toolFiles = {
  hypertask_list_projects: 'listProjects',
  hypertask_list_tasks: 'listTasks',
  hypertask_search_tasks: 'searchTasks',
  hypertask_get_tasks: 'getTasks',
  hypertask_create_task: 'createTask',
  hypertask_update_task: 'updateTask',
  hypertask_get_comments: 'getCommentsForTask',
  hypertask_add_comment: 'addComment',
  hypertask_list_labels: 'listLabels',
  hypertask_assign_user: 'assignUser',
};

function chatTools() {
  const scope = {
    z,
    ...load(path.join(root, 'src/lib/ai/chatStream/request.ts')),
    ...load(path.join(root, 'src/lib/ai/tools/constants.ts')),
    ...load(path.join(root, 'src/lib/ai/tools/schemas.ts')),
    ...load(path.join(root, 'src/lib/ai/tools/updateTaskSchema.ts')),
    ...load(path.join(root, 'src/lib/ai/chatStream/prompt.ts')),
  };
  return Object.fromEntries(Object.entries(toolFiles).map(([name, file]) => {
    const filename = path.join(root, `src/lib/ai/tools/${file}.ts`);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    let schema;
    let description;
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'inputSchema') {
        schema = vm.runInNewContext(node.initializer.getText(source), scope, { timeout: 1000 });
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'description') {
        description ??= vm.runInNewContext(node.initializer.getText(source), scope, { timeout: 1000 });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(schema && description, `Missing chat schema: ${name}`);
    return [name, { schema, description }];
  }));
}

function mcpTools() {
  const task = load(path.join(root, 'src/lib/mcp-server/validations/task.validation.ts'));
  const project = load(path.join(root, 'src/lib/mcp-server/validations/project.validation.ts'));
  const comment = load(path.join(root, 'src/lib/mcp-server/validations/comment.validation.ts'));
  const schemas = {
    LIST_PROJECTS: project.getListProjectsInputSchema(),
    LIST_TASKS: task.getListTasksInputSchema(),
    SEARCH_TASKS: task.getEnhancedSearchTasksInputSchema(),
    GET_TASKS: task.getGetTasksInputSchema(),
    CREATE_TASK: task.getCreateTaskInputSchema(),
    UPDATE_TASK: task.getUpdateTaskBaseSchema(),
    GET_COMMENTS: comment.getGetCommentsBaseSchema(),
    ADD_COMMENT: comment.getAddCommentCrudBaseSchema(),
    LIST_LABELS: project.getListLabelsBaseSchema(),
    ASSIGN_USER: task.getAssignUserBaseSchema(),
  };
  // Load metadata only, not its report-service import or any production database code.
  const filename = path.join(root, 'src/lib/mcp-server/config/tool-metadata.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const scope = load(path.join(root, 'src/lib/mcp-server/config/mcp-standards.ts'));
  const metadata = {};
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && Object.hasOwn(schemas, node.name.getText(source))) {
      metadata[node.name.getText(source)] = vm.runInNewContext(`(${node.initializer.getText(source)})`, scope, { timeout: 1000 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.fromEntries(Object.entries(schemas).map(([key, schema]) => {
    assert.ok(metadata[key], `Missing MCP metadata: ${key}`);
    return [metadata[key].name, { schema, description: metadata[key].description }];
  }));
}

function validateCall(call, tools) {
  assert.equal(typeof call.id, 'string', 'Tool call needs an id');
  const tool = tools[call.name];
  assert.ok(tool, `Unknown tool: ${call.name}`);
  assert.ok(call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments), 'Tool arguments must be an object');
  const json = z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' });
  for (const key of Object.keys(call.arguments)) {
    assert.ok(Object.hasOwn(json.properties ?? {}, key), `Unexpected argument ${key} on ${call.name}`);
  }
  tool.schema.parse(call.arguments);
}

async function runTask(task, tools, model, maxSteps = 8) {
  const messages = [{ role: 'user', content: task.request }];
  const calls = [];
  let retries = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finished = false;
  for (let step = 0; step < maxSteps; step++) {
    const turn = await model({ task, messages, tools, step });
    assert.ok(Number.isInteger(turn.inputTokens) && turn.inputTokens >= 0, 'Invalid input tokens');
    assert.ok(Number.isInteger(turn.outputTokens) && turn.outputTokens >= 0, 'Invalid output tokens');
    inputTokens += turn.inputTokens;
    outputTokens += turn.outputTokens;
    assert.ok(Array.isArray(turn.calls), 'Missing tool calls');
    if (!turn.calls.length) { finished = true; break; }
    messages.push({ role: 'assistant', calls: turn.calls });
    for (const call of turn.calls) {
      validateCall(call, tools);
      calls.push(call);
      const fixture = task.results[call.name];
      assert.ok(fixture, `No isolated tool result for ${call.name}`);
      const result = Array.isArray(fixture) ? fixture.shift() : fixture;
      assert.ok(result, `Exhausted results for ${call.name}`);
      if (result.retryable) retries++;
      messages.push({ role: 'tool', id: call.id, name: call.name, result });
    }
  }
  assert.ok(finished, `Step limit reached for ${task.id}`);
  const actual = calls.map((call) => call.name);
  const wrongTools = actual.reduce((count, name, index) => count + Number(name !== task.expected[index]), 0)
    + Math.max(0, task.expected.length - actual.length);
  for (const [index, expected] of Object.entries(task.arguments ?? {})) {
    assert.ok(require('node:util').isDeepStrictEqual(calls[Number(index)]?.arguments, expected), `Incorrect arguments for ${task.id} call ${index}`);
  }
  return { id: task.id, surface: task.surface, calls, wrongTools, retries, inputTokens, outputTokens };
}

async function liveModel({ task, messages, tools }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  assert.ok(apiKey, 'AI_EVAL_LIVE=1 requires ANTHROPIC_API_KEY');
  const { AGENT_SYSTEM_PROMPT } = load(path.join(root, 'src/lib/ai/chatStream/prompt.ts'));
  const history = messages.flatMap((message) => {
    if (message.role === 'tool') return [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: message.id, content: JSON.stringify(message.result) }] }];
    if (message.role === 'assistant') return [{ role: 'assistant', content: message.calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })) }];
    return [message];
  });
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5.5', max_tokens: 1024,
      system: task.surface === 'chat' ? AGENT_SYSTEM_PROMPT : 'Use the Hypertask MCP tools to carry out the user request. Copy identifiers from tool results.',
      messages: history,
      tools: Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description, input_schema: z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }) })),
    }),
    signal: AbortSignal.timeout(60000),
  });
  assert.ok(response.ok, `Live eval provider returned ${response.status}`);
  const body = await response.json();
  return {
    calls: body.content.filter((item) => item.type === 'tool_use').map((item) => ({ id: item.id, name: item.name, arguments: item.input })),
    inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens,
  };
}

function recordedContract(catalogs) {
  const { createHash } = require('node:crypto');
  const { AGENT_SYSTEM_PROMPT } = load(path.join(root, 'src/lib/ai/chatStream/prompt.ts'));
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    chatPrompt: digest(AGENT_SYSTEM_PROMPT),
    tools: Object.fromEntries(Object.entries(catalogs).map(([surface, tools]) => [surface,
      Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, digest({ description: tool.description, schema: z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }) })])),
    ])),
  };
}

async function evaluate({ golden, fixtures, live = false, threshold = 0, contract }) {
  assert.ok(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1, 'Wrong-tool threshold must be between 0 and 1');
  assert.ok(golden.tasks.length >= 5, 'Golden set needs at least five tasks');
  const catalogs = { chat: chatTools(), mcp: mcpTools() };
  if (!live && contract) assert.deepEqual(recordedContract(catalogs), contract, 'Recorded fixtures are stale: review tool/prompt changes and refresh the contract');
  const results = [];
  for (const original of golden.tasks) {
    const task = structuredClone(original);
    const tools = catalogs[task.surface];
    assert.ok(tools, `Unknown surface ${task.surface}`);
    const model = live ? liveModel : async ({ step }) => {
      const turn = fixtures[task.id]?.[step];
      assert.ok(turn, `Missing recorded turn for ${task.id}`);
      return turn;
    };
    results.push(await runTask(task, tools, model));
  }
  const wrongTools = results.reduce((sum, task) => sum + task.wrongTools, 0);
  const expectedCalls = golden.tasks.reduce((sum, task) => sum + task.expected.length, 0);
  const wrongToolRate = wrongTools / Math.max(expectedCalls, 1);
  assert.ok(wrongToolRate <= threshold, `Wrong-tool rate ${wrongToolRate} exceeds threshold ${threshold}`);
  return { mode: live ? 'live' : 'recorded', wrongToolRate, results };
}

module.exports = { chatTools, mcpTools, validateCall, runTask, evaluate, recordedContract };
if (require.main === module) {
  evaluate({
    golden: JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ai/golden-tasks.json'), 'utf8')),
    fixtures: JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ai/recorded-turns.json'), 'utf8')),
    contract: JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ai/recorded-contract.json'), 'utf8')),
    live: process.env.AI_EVAL_LIVE === '1',
    threshold: Number(process.env.AI_EVAL_WRONG_TOOL_THRESHOLD ?? 0),
  }).then((report) => {
    // The report contains only fixture tool calls and metrics, never model text.
    console.log(JSON.stringify({ ...report, results: report.results.map((task) => ({ ...task, calls: task.calls.map(({ id, name }) => ({ id, name })) })) }, null, 2));
    console.log('AI evals passed');
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
