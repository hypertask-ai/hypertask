const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');

const flag = 'htpr-9371-view-me-assignee';
const agentId = '1f7f1a51-4a8e-4e2a-9a52-0b2a5f1a8c11';
const person = { id: 6, uid: 'firebase-user-6', displayName: 'Valentin Yeo', photoURL: null };
const agent = { id: agentId, displayName: 'HT Design Lead' };

function fixture({ flagOn = true, storedBoardFilters = { matchFilters: 'ANY', addedFilters: [] } } = {}) {
  const calls = { created: [], updated: [] };
  const flagReads = [];
  const prisma = {
    $transaction: async operation => operation(prisma),
    label: { findMany: async () => [] },
    section: { findMany: async () => [] },
    project: { findFirst: async () => ({ id: 15 }) },
    project_View: {
      upsert: async () => ({ id: 'project-view-1', default_view: null }),
      update: async () => undefined,
    },
    user: { findMany: async () => [person] },
    agent: { findMany: async () => [agent] },
    view: {
      findFirst: async () => null,
      findUnique: async () => ({
        id: 'view-1',
        title: 'Design lead queue',
        userId: 6,
        visibility: 'Public',
        board_filters: storedBoardFilters,
        board_sorting_mode: 'Manual',
        project_view: { id: 'project-view-1', projectId: 15, default_view_id: null },
      }),
      create: async args => {
        calls.created.push(args);
        return { id: 'view-1', title: args.data.title, slug: null, visibility: args.data.visibility, board_filters: args.data.board_filters };
      },
      update: async args => {
        calls.updated.push(args);
        return {
          id: 'view-1',
          title: 'Design lead queue',
          slug: null,
          visibility: 'Public',
          board_filters: args.data.board_filters,
          board_sorting_mode: 'Manual',
          board_sorting_order: 'Descending',
        };
      },
    },
  };

  const modules = loadModule('src/lib/mcp/views/services.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/realtime/server': { broadcastBoardChange: () => undefined },
    '@/lib/mcp/tasks/services': {
      matchLabelIds: (labels, names) => ({ ids: [], unresolved: names }),
      validateProjectAccess: async () => ({}),
      validateProjectMemberIds: async () => ({ invalidIds: [], error: null }),
    },
    '@/lib/mcp/labelMessages': { unresolvedLabelMessage: names => `Label(s) not found in project: ${names.join(', ')}` },
    '@/lib/mcp-server/utils/errors': { ValidationError: class ValidationError extends Error {} },
    '@/lib/flags': {
      isFeatureEnabled: async (key, userId) => {
        flagReads.push({ key, userId });
        return key === flag ? flagOn : false;
      },
    },
    '@/utils/controllers/projects/getAllIncludes': { savedViewBoardAccessWhere: () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {
      getUniqueSlug: async () => 'design-lead-queue',
      getViewUrl: () => null,
    },
    '@/utils/controllers/projects/views/boardFilterWriteLock': {
      acquireBoardFilterWriteLock: async () => undefined,
      assertViewIsNotManagedSmartSplit: async () => undefined,
      validateBoardFilterLabelReferences: async () => undefined,
    },
    '@/utils/helperFunctions/Views/ViewsHelperFunctions': { sanitizeSortingStack: () => [] },
    '@/models/Views/model': { DEFAULT_SUBTASK_SETTING: 'None' },
  });

  return { ...modules, calls, flagReads };
}

test('an agent can filter a new view to itself with me', async () => {
  const { createView, calls, flagReads } = fixture();

  await createView({
    projectId: 15,
    userId: 6,
    agentId,
    title: 'Design lead queue',
    filters: { assignee_ids: ['me'] },
  });

  assert.deepEqual(calls.created[0].data.board_filters.addedFilters, [
    { type: 'Assignees', searchPayload: [agent] },
  ]);
  assert.deepEqual(flagReads[0], { key: flag, userId: 6 });
});

test('a person keeps their own id when the filter says me', async () => {
  const { createView, calls } = fixture();

  await createView({
    projectId: 15,
    userId: 6,
    title: 'My queue',
    filters: { assignee_ids: ['me'] },
  });

  assert.deepEqual(calls.created[0].data.board_filters.addedFilters, [
    { type: 'Assignees', searchPayload: [person] },
  ]);
});

test('with the flag off me is refused instead of matching nobody', async () => {
  const { createView } = fixture({ flagOn: false });

  await assert.rejects(
    createView({
      projectId: 15,
      userId: 6,
      agentId,
      title: 'Design lead queue',
      filters: { assignee_ids: ['me'] },
    }),
    /assignee me is neither a project member nor an agent on this board/,
  );
});

test('updating only the assignee filter rewrites the stored filters', async () => {
  const storedBoardFilters = {
    matchFilters: 'ANY',
    addedFilters: [{ type: 'Priority', searchPayload: [{ priority_index: 1, Priority_Value: 'Urgent' }] }],
  };
  const { updateView, calls } = fixture({ storedBoardFilters });

  await updateView({
    viewId: 'view-1',
    userId: 6,
    agentId,
    filters: { assignee_ids: ['me'] },
  });

  assert.deepEqual(calls.updated[0].data.board_filters, {
    matchFilters: 'ANY',
    addedFilters: [
      { type: 'Priority', searchPayload: [{ priority_index: 1, Priority_Value: 'Urgent' }] },
      { type: 'Assignees', searchPayload: [agent] },
    ],
  });
});
