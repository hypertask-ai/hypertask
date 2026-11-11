const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const types = load('src/lib/mcp/tasks/fields/types.ts');
const errorMessage = load('src/lib/api/errorMessage.ts');
const sectionLookup = load('src/lib/mcp/boards/sectionLookup.ts', {
  '@/lib/prisma': {
    __esModule: true,
    default: {
      section: {
        findMany: async () => [
          { id: 4309, section_title: 'In Progress' },
          { id: 4310, section_title: 'QA' },
        ],
      },
    },
  },
});
const { updateTaskSection } = load('src/lib/mcp/tasks/fields/section.ts', {
  '@/lib/api/errorMessage': errorMessage,
  '@/lib/flags': { isFeatureEnabled: async () => true },
  '@/lib/flags/definitions/htpr-7990-task-move-refusal': { HTPR_7990_TASK_MOVE_REFUSAL_FLAG: 'htpr-7990-task-move-refusal' },
  '@/lib/mcp/boards/sectionLookup': sectionLookup,
});
const errors = load('src/lib/mcp-server/utils/errors.ts', {});
const fixable = load('src/lib/aiFeedback/callerFixable.ts', {});

const context = {
  ctx: { user: { id: 985 }, agentId: null, teamScope: null },
  user: { id: 985 },
  requestBody: { sectionId: 32923 },
  sectionInfo: undefined,
  baseUrl: 'https://app.hypertask.ai',
  authCookieHeader: 'test-session',
};
const task = { id: 1, projectId: 15, sectionId: 4309, status: 'Normal' };

function sectionContext(sectionInfo) {
  return { ...context, sectionInfo };
}

test('a section id from another board is a 400 the caller can fix, not a 500', async () => {
  await assert.rejects(
    () => updateTaskSection(sectionContext({ projectId: 11514, section_title: 'Backlog' }), task),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'invalid_value');
      assert.equal(error.field, 'sectionId');
      assert.match(error.message, /hypertask_move_task_between_boards/);
      return true;
    },
  );
});

test('a section id that matches no column is a 400, not a silent success', async () => {
  await assert.rejects(
    () => updateTaskSection(sectionContext(undefined), task),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'not_found');
      assert.equal(error.field, 'sectionId');
      assert.match(error.message, /Columns on this board: In Progress \(id 4309\), QA \(id 4310\)/);
      return true;
    },
  );
});

test('the 400 keeps code and field for the agent and files no bug ticket', () => {
  const refusal = { success: false, tasks: [], error: 'sectionId must be a column on the task own board.', code: 'invalid_value', field: 'sectionId' };
  const error = errors.mapHttpErrorToMcpError(400, refusal.error, 'corr-8512', refusal);
  assert.deepEqual(error.details, { code: 'invalid_value', field: 'sectionId' });
  assert.equal(fixable.callerCanFixRefusal(error.details, 400), true);
});

const fieldUpdaters = {
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

function loadPersist(section) {
  return load('src/lib/mcp/tasks/fields/persist.ts', {
    '@/lib/planLimits': { isPlanLimitReachedError: () => false },
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null },
    '@/lib/prisma': { __esModule: true, default: { task: { findMany: async () => [] } } },
    '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), mapTaskToDetail: (row) => row },
    '@/lib/mcp/tasks/broadcastTaskUpdates': { broadcastTaskUpdates: async () => {} },
    '@/lib/mcp/tasks/agentMutationFence': {},
    '@/lib/api/errorMessage': errorMessage,
    '@/lib/agents/activityAttribution': {},
    '@/lib/pullRequests/taskPullRequests': { PullRequestLinkError: class extends Error {} },
    './types': types,
    './section': section,
    ...Object.fromEntries(Object.entries(fieldUpdaters).map(([key, value]) => [`./${key}`, value])),
  });
}

test('the update route answers the section refusal with 400 and its field', async () => {
  const { persistTaskUpdates } = loadPersist({
    updateTaskSection: async () => {
      throw Object.assign(new Error('sectionId must be a column on the task own board.'), { status: 400, code: 'invalid_value', field: 'sectionId' });
    },
  });
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await assert.rejects(() => persistTaskUpdates(context, [task]), refused => {
      assert.equal(refused.status, 400);
      assert.equal(refused.response.code, 'invalid_value');
      assert.equal(refused.response.field, 'sectionId');
      return true;
    });
  } finally {
    console.warn = warn;
    console.error = error;
  }
});

test('a genuine server fault still answers 500 with no field', async () => {
  const { persistTaskUpdates } = loadPersist({
    updateTaskSection: async () => {
      throw new Error('database is unreachable');
    },
  });
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    await assert.rejects(() => persistTaskUpdates(context, [task]), refused => {
      assert.equal(refused.status, 500);
      assert.equal(refused.response.code, undefined);
      assert.equal(refused.response.field, undefined);
      return true;
    });
  } finally {
    console.warn = warn;
    console.error = error;
  }
});
