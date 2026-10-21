// HTPR-7163: setting, clearing or changing a task's priority or estimate needs
// write access to that task's board.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const { load } = require('./task-route-loader.cjs');

const WRITE_ACCESS = { writeAccessFor: 7 };

// Task 10 is on the user's board; task 20 is on another team's board. Both
// already have a priority and an estimate.
function loadSetter(file, field) {
  const writes = [];
  const accessArgs = [];
  const existing = { id: `${field}-row`, [`${field}_index`]: 2, Priority_Value: 'High', estimate_value: 'M' };
  const tasks = { 10: { id: 10, projectId: 1, sectionId: 5 }, 20: { id: 20, projectId: 2, sectionId: 6 } };
  const model = {
    deleteMany: async (q) => { writes.push(['delete', q.where.taskId]); return { count: 1 }; },
    create: async (q) => { writes.push(['create', q.data.taskId]); return q.data; },
    update: async (q) => { writes.push(['update', q.where.id]); return q.data; },
  };
  const prisma = {
    task: {
      findFirst: async ({ where }) => {
        const task = tasks[where.id];
        if (!task || where.project !== WRITE_ACCESS || task.projectId !== 1) return null;
        return { ...task, [field]: existing };
      },
      // The old code looked tasks up without any access check.
      findUnique: async ({ where }) => (tasks[where.id] ? { ...tasks[where.id], [field]: existing } : null),
    },
    agent: { findUnique: async () => null },
    [field]: model,
  };
  const scope = load('src/lib/auth/agentScope.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/prisma': { default: { member: { findMany: async () => [] } } },
    '@/lib/telemetry/signupAnalytics': { recordServerCapture: () => {} },
  });
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  const activity = { __esModule: true, default: () => {} };
  const stubs = {
    '@/lib/auth/agentScope': scope,
    '@/lib/auth/resolveActingAgent': load('src/lib/auth/resolveActingAgent.ts', {}),
    '@/utils/controllers/tasks/assertTaskAccess': { userCanAccessTask: async () => { throw new Error('WATCH must use the existing content access query'); } },
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/utils/controllers/activities/CreatePriorityActivity': activity,
    '@/utils/controllers/activities/createEstimateActivity': activity,
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 7 }) },
    '@/lib/auth/sessionUserRecord': { loadSessionUserRecord: async () => ({ id: 7 }) },
    '@/utils/controllers/projects/getAllIncludes': {
      taskWriteAccessWhere: (...args) => { accessArgs.push(args); return WRITE_ACCESS; },
    },
  };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? require(id),
    console: { log() {}, error() {} }, Headers, Date,
  }, { filename });
  async function call(body) {
    const res = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json() { return this; } };
    await loaded.exports.default({ method: 'POST', headers: {}, body }, res);
    return res.statusCode;
  }
  return { call, writes, accessArgs };
}

test('an agent acting for the user is checked as that user\'s own agent', async () => {
  const { call, accessArgs } = loadSetter('src/pages/api/priority/setPriority.ts', 'priority');
  await call({ taskId: 10, priority_index: 4, Priority_Value: 'Low', agentId: 'agent-1' });
  await call({ taskId: 10, priority_index: 4, Priority_Value: 'Low', agentId: { id: 'x' } });
  assert.deepEqual(accessArgs, [[7, 'agent-1'], [7, null]]);
});

const SETTERS = [
  ['priority', 'src/pages/api/priority/setPriority.ts', (taskId, index) => ({ taskId, priority_index: index, Priority_Value: 'Low' })],
  ['estimate', 'src/pages/api/estimate/setEstimate.ts', (taskId, index) => ({ taskId, estimate_index: index, estimate_value: 'S' })],
];

for (const [field, file, body] of SETTERS) {
  test(`${field}: clearing or changing another team's task is refused and writes nothing`, async () => {
    const { call, writes } = loadSetter(file, field);
    assert.equal(await call(body(20, 0)), 404, 'clear');
    assert.equal(await call(body(20, 4)), 404, 'change');
    assert.equal(await call(body(999, 4)), 404, 'missing task');
    assert.deepEqual(writes, []);
  });

  test(`${field}: your own task still clears and changes`, async () => {
    const { call, writes } = loadSetter(file, field);
    assert.equal(await call(body(10, 0)), 200);
    assert.equal(await call(body(10, 4)), 200);
    assert.deepEqual(writes, [['delete', 10], ['update', `${field}-row`]]);
  });
}
