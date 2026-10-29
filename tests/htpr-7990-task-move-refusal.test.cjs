const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const types = load('src/lib/mcp/tasks/fields/types.ts');
const errorMessage = load('src/lib/api/errorMessage.ts');
let enabled = true;
const { updateTaskSection } = load('src/lib/mcp/tasks/fields/section.ts', {
  '@/lib/api/errorMessage': errorMessage,
  '@/lib/flags': { isFeatureEnabled: async () => enabled },
  '@/lib/flags/definitions/htpr-7990-task-move-refusal': { HTPR_7990_TASK_MOVE_REFUSAL_FLAG: 'htpr-7990-task-move-refusal' },
});
const fields = {
  section: { updateTaskSection },
  status: { updateTaskStatus: async () => {} },
  text: { updateTaskText: async () => {} },
  dueDate: { updateTaskDueDate: async () => {} },
  priority: { updateTaskPriority: async () => {} },
  estimate: { updateTaskEstimate: async () => {} },
  labels: { updateTaskLabels: async () => {} },
  contract: { updateTaskContract: async () => {} },
  pullRequest: { updateTaskPullRequest: async () => {} },
  assignees: { updateTaskAssignees: async () => {} },
};
const { persistTaskUpdates } = load('src/lib/mcp/tasks/fields/persist.ts', {
  '@/lib/planLimits': { isPlanLimitReachedError: () => false },
  '@/utils/controllers/projects/getAllIncludes': {},
  '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null },
  '@/lib/prisma': { __esModule: true, default: { task: { findMany: async ({ where }) => where.id.in.map(id => ({ id })) } } },
  '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), mapTaskToDetail: task => task },
  '@/lib/mcp/tasks/broadcastTaskUpdates': { broadcastTaskUpdates: async () => {} },
  '@/lib/mcp/tasks/agentMutationFence': {},
  '@/lib/api/errorMessage': errorMessage,
  '@/lib/agents/activityAttribution': {},
  '@/lib/pullRequests/taskPullRequests': { PullRequestLinkError: class extends Error {} },
  './types': types,
  ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`./${key}`, value])),
});
const context = {
  ctx: { user: { id: 985 }, agentId: null, teamScope: null },
  user: { id: 985 },
  requestBody: { sectionId: 10 },
  sectionInfo: { projectId: 15, section_title: 'Flag: Everyone' },
  baseUrl: 'https://app.hypertask.ai',
  authCookieHeader: 'test-session',
};
const task = { id: 1, projectId: 15, sectionId: 9, status: 'Normal' };

async function withMoveResponse(status, run, flag = true) {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const errors = [];
  enabled = flag;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://app.hypertask.ai/api/tasks/moveTask');
    assert.equal(options.method, 'PUT');
    const id = JSON.parse(options.body).taskId;
    const code = typeof status === 'function' ? status(id) : status;
    return Response.json({ message: code === 409 ? 'Cannot move to Flag: Everyone. Not released: test (OWNER_AND_QA).' : 'Move result' }, { status: code });
  };
  console.warn = () => {};
  console.error = (...args) => errors.push(args);
  try { await run(errors); } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
    enabled = true;
  }
}

test('a refused move stays 409 through the real section and persistence code', async () => {
  await withMoveResponse(409, async errors => {
    await assert.rejects(persistTaskUpdates(context, [task]), error => {
      assert.equal(error.status, 409);
      assert.equal(error.response.code, 'task_move_refused');
      assert.match(error.response.error, /Cannot move to Flag: Everyone/);
      return true;
    });
    assert.equal(errors.length, 0);
  });
});

test('successful moves still return the updated task', async () => {
  await withMoveResponse(200, async () => {
    const response = await persistTaskUpdates(context, [task]);
    assert.equal(response.success, true);
    assert.deepEqual(response.tasks, [{ id: 1 }]);
  });
});

test('real server failures remain 500 and logged', async () => {
  await withMoveResponse(500, async errors => {
    await assert.rejects(persistTaskUpdates(context, [task]), error => error.status === 500);
    assert.equal(errors.length, 1);
  });
});

test('partial updates keep a successful task and the refused task details', async () => {
  await withMoveResponse(id => id === 1 ? 200 : 409, async () => {
    const response = await persistTaskUpdates(context, [task, { ...task, id: 2 }]);
    assert.equal(response.success, true);
    assert.deepEqual(response.tasks, [{ id: 1 }]);
    assert.equal(response.failed_tasks[0].status, 409);
    assert.equal(response.failed_tasks[0].taskId, 2);
  });
});

test('switching the flag off restores the previous error response', async () => {
  await withMoveResponse(409, async () => {
    await assert.rejects(persistTaskUpdates(context, [task]), error => error.status === 500);
  }, false);
});
