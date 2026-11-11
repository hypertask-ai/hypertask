const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');

const labelId = 'd706b192-9425-4ca0-99c9-3ebd88ddd16b';
const otherLabelId = '6b1f0e72-2b1f-4b52-9f4d-1f6d0f2c9a11';

const labels = [
  { id: labelId, value: 'Bug' },
  { id: otherLabelId, value: 'Docs' },
];

function fixture(storedBoardFilters) {
  const updateCalls = [];
  const storedView = {
    id: 'view-1',
    title: 'Stored view',
    userId: 6,
    visibility: 'Public',
    board_filters: storedBoardFilters,
    board_sorting_mode: 'Manual',
    project_view: { id: 'project-view-1', projectId: 15, default_view_id: null },
  };
  const prismaStub = {
    $transaction: async operation => operation(prismaStub),
    label: { findMany: async () => labels },
    user: {
      findMany: async () => [
        { id: 42, uid: 'firebase-user-42', displayName: 'Person', photoURL: null },
      ],
    },
    agent: { findMany: async () => [] },
    project_View: { update: async () => undefined },
    view: {
      findUnique: async () => storedView,
      findFirst: async () => null,
      update: async args => {
        updateCalls.push(args);
        return {
          id: storedView.id,
          title: storedView.title,
          slug: null,
          visibility: storedView.visibility,
          board_filters: args.data.board_filters,
          board_sorting_mode: 'Manual',
          board_sorting_order: 'Descending',
        };
      },
    },
  };

  const { updateView } = loadModule('src/lib/mcp/views/services.ts', {
    '@/lib/prisma': { default: prismaStub },
    '@/lib/realtime/server': { broadcastBoardChange: () => undefined },
    '@/lib/mcp/tasks/services': {
      matchLabelIds: (projectLabels, names) => {
        const ids = [];
        const unresolved = [];
        for (const name of names) {
          const match = projectLabels.find(label => label.value === name);
          if (match) ids.push(match.id);
          else unresolved.push(name);
        }
        return { ids, unresolved };
      },
      validateProjectAccess: async () => ({}),
      validateProjectMemberIds: async () => ({ invalidIds: [], error: null }),
    },
    '@/lib/mcp/labelMessages': { unresolvedLabelMessage: names => `Label(s) not found in project: ${names.join(', ')}` },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/controllers/projects/getAllIncludes': { savedViewBoardAccessWhere: () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {
      getUniqueSlug: async () => null,
      getViewUrl: () => null,
    },
    '@/utils/controllers/projects/views/boardFilterWriteLock': {
      acquireBoardFilterWriteLock: async () => undefined,
      assertViewIsNotManagedSmartSplit: async () => undefined,
      validateBoardFilterLabelReferences: async () => undefined,
    },
    '@/models/Views/model': { DEFAULT_SUBTASK_SETTING: 'None' },
  });

  return { updateView, updateCalls };
}

test('updateView merges flat label filters into supplied native board filters', async () => {
  const priorityEntry = { type: 'Priority', searchPayload: [{ priority_index: 1, Priority_Value: 'Urgent' }] };
  const { updateView, updateCalls } = fixture({ matchFilters: 'ANY', addedFilters: [] });

  await updateView({
    viewId: 'view-1',
    userId: 6,
    board_filters: { matchFilters: 'ANY', addedFilters: [priorityEntry] },
    filters: { label_names: ['Bug'] },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: 'ANY',
    addedFilters: [priorityEntry, { type: 'Labels', searchPayload: [{ id: labelId }] }],
  });
});

test('updateView lets an explicit label list replace the labels inside supplied native filters', async () => {
  const { updateView, updateCalls } = fixture({ matchFilters: 'ANY', addedFilters: [] });

  await updateView({
    viewId: 'view-1',
    userId: 6,
    board_filters: {
      matchFilters: 'ANY',
      addedFilters: [{ type: 'Labels', searchPayload: [{ id: otherLabelId }] }],
    },
    filters: { label_names: ['Bug'] },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: 'ANY',
    addedFilters: [{ type: 'Labels', searchPayload: [{ id: labelId }] }],
  });
});

test('updateView merges flat assignee filters into supplied native board filters', async () => {
  const { updateView, updateCalls } = fixture({ matchFilters: 'ANY', addedFilters: [] });

  await updateView({
    viewId: 'view-1',
    userId: 6,
    board_filters: { matchFilters: 'ALL', addedFilters: [] },
    filters: { assignee_ids: [42] },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: 'ALL',
    addedFilters: [
      {
        type: 'Assignees',
        searchPayload: [
          { id: 42, uid: 'firebase-user-42', displayName: 'Person', photoURL: null },
        ],
      },
    ],
  });
});

test('updateView applies a flat match mode to supplied native filters without dropping their entries', async () => {
  const priorityEntry = { type: 'Priority', searchPayload: [{ priority_index: 2, Priority_Value: 'High' }] };
  const { updateView, updateCalls } = fixture({ matchFilters: 'ANY', addedFilters: [] });

  await updateView({
    viewId: 'view-1',
    userId: 6,
    board_filters: { matchFilters: 'ANY', addedFilters: [priorityEntry] },
    filters: { match: 'ALL' },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: 'ALL',
    addedFilters: [priorityEntry],
  });
});

test('updateView still replaces the stored filters when only native board filters are supplied', async () => {
  const { updateView, updateCalls } = fixture({
    matchFilters: 'ALL',
    addedFilters: [{ type: 'Labels', searchPayload: [{ id: otherLabelId }] }],
  });

  await updateView({
    viewId: 'view-1',
    userId: 6,
    board_filters: { matchFilters: 'ANY', addedFilters: [] },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, { matchFilters: 'ANY', addedFilters: [] });
});

test('updateView refuses hide-tags when the flat label_match asks for it and the flag is off', async () => {
  const { updateView, updateCalls } = fixture({ matchFilters: 'ANY', addedFilters: [] });

  await assert.rejects(
    updateView({
      viewId: 'view-1',
      userId: 6,
      board_filters: { matchFilters: 'ANY', addedFilters: [] },
      filters: { label_names: ['Bug'], label_match: 'HIDE' },
    }),
    /Hiding tickets by tag is not available\./,
  );
  assert.deepEqual(updateCalls, []);
});

test('updateView merges flat filters without native filters into the stored filters', async () => {
  const storedLabels = { type: 'Labels', searchPayload: [{ id: otherLabelId }] };
  const assigneesEntry = {
    type: 'Assignees',
    searchPayload: [{ id: 42, uid: 'firebase-user-42', displayName: 'Person', photoURL: null }],
  };
  const { updateView, updateCalls } = fixture({
    matchFilters: 'ALL',
    addedFilters: [storedLabels, assigneesEntry],
  });

  await updateView({ viewId: 'view-1', userId: 6, filters: { label_names: [] } });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: 'ALL',
    addedFilters: [assigneesEntry],
  });
});
