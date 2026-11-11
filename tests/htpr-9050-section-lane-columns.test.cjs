const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const boardColumns = [
  { id: 41, section_title: 'Triage' },
  { id: 42, section_title: 'In Progress' },
  { id: 43, section_title: 'In Review' },
  { id: 44, section_title: 'Done' },
];

function loadLookup(columns, seen = []) {
  return load('src/lib/mcp/boards/sectionLookup.ts', {
    '@/lib/prisma': {
      __esModule: true,
      default: {
        section: {
          findMany: async (args) => {
            seen.push(args);
            return columns;
          },
        },
      },
    },
  });
}

function loadUpdate(sectionLookup, flagOn) {
  return load('src/lib/mcp/tasks/fields/section.ts', {
    '@/lib/api/errorMessage': load('src/lib/api/errorMessage.ts', {}),
    '@/lib/flags': { isFeatureEnabled: async () => flagOn },
    '@/lib/flags/definitions/htpr-7990-task-move-refusal': { HTPR_7990_TASK_MOVE_REFUSAL_FLAG: 'htpr-7990-task-move-refusal' },
    '@/lib/mcp/boards/sectionLookup': sectionLookup,
  });
}

function updateContext() {
  return {
    ctx: { user: { id: 985 }, agentId: null, teamScope: null },
    user: { id: 985 },
    requestBody: { sectionId: 999 },
    sectionInfo: undefined,
    baseUrl: 'https://app.hypertask.ai',
    authCookieHeader: 'test-session',
  };
}

const task = { id: 1, projectId: 15, sectionId: 4309, status: 'Normal' };

test('an unknown column is refused with the board columns a review lane could be', async () => {
  const { sectionRefusal } = loadLookup(boardColumns);
  assert.equal(
    await sectionRefusal(11514, 999, true),
    'Section with ID 999 not found in project 11514. Columns on this board: Triage (id 41), In Progress (id 42), In Review (id 43), Done (id 44)',
  );
});

test('the lookup reads only this board\'s live visible columns in board order', async () => {
  const seen = [];
  const { visibleBoardColumns } = loadLookup(boardColumns, seen);
  assert.deepEqual(await visibleBoardColumns(15), boardColumns);
  assert.deepEqual(seen[0].where, { projectId: 15, deleted: false, visibility: true });
  assert.deepEqual(seen[0].orderBy, { ranking: 'asc' });
});

test('flag off returns the bare refusal for a section id', async () => {
  const { sectionRefusal } = loadLookup(boardColumns);
  assert.equal(
    await sectionRefusal(15, 999, false),
    'Section with ID 999 not found in project 15',
  );
});

test('a board with no visible columns keeps the plain refusal instead of an empty list', async () => {
  const { sectionRefusal } = loadLookup([]);
  assert.equal(
    await sectionRefusal(15, 999, true),
    'Section with ID 999 not found in project 15.',
  );
});

test('the column list comes from the board that was asked about, never a fixed list', async () => {
  const boardA = loadLookup([{ id: 1, section_title: 'Backlog' }, { id: 2, section_title: 'Done' }]);
  const boardB = loadLookup([{ id: 7, section_title: 'Agent Blocked' }]);
  assert.equal(
    await boardA.sectionRefusal(15, 999, true),
    'Section with ID 999 not found in project 15. Columns on this board: Backlog (id 1), Done (id 2)',
  );
  assert.equal(
    await boardB.sectionRefusal(11514, 999, true),
    'Section with ID 999 not found in project 11514. Columns on this board: Agent Blocked (id 7)',
  );
});

test('the task update refusal names the task board columns', async () => {
  const { updateTaskSection } = loadUpdate(loadLookup(boardColumns), true);
  await assert.rejects(() => updateTaskSection(updateContext(), task), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'not_found');
    assert.equal(error.field, 'sectionId');
    assert.match(error.message, /Columns on this board: Triage \(id 41\), In Progress \(id 42\), In Review \(id 43\), Done \(id 44\)$/);
    return true;
  });
});

test('a bulk update asks for one board list, not one per ticket', async () => {
  const seen = [];
  const { updateTaskSection } = loadUpdate(loadLookup(boardColumns, seen), true);
  const context = updateContext();
  await Promise.all([1, 2, 3, 4, 5].map((id) => updateTaskSection(context, { ...task, id }).catch(() => {})));
  assert.equal(seen.length, 1);
});

test('flag off keeps the bare update refusal agents saw before', async () => {
  const { updateTaskSection } = loadUpdate(loadLookup(boardColumns), false);
  await assert.rejects(() => updateTaskSection(updateContext(), task), (error) => {
    assert.equal(
      error.message,
      'sectionId does not match a column. Pass a column id from the task\'s own board.',
    );
    return true;
  });
});

test('the flag ships for everyone as a bugfix', () => {
  const definition = load('src/lib/flags/definitions/htpr-9050-section-columns.ts', {});
  assert.equal(definition.HTPR_9050_SECTION_COLUMNS_FLAG, 'htpr-9050-section-columns');
  assert.equal(definition.default.kind, 'bugfix');
  assert.equal(definition.default.defaultMode, 'EVERYONE');
});
