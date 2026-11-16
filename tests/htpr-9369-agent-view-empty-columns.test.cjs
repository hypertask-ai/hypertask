const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const viewId = 'd706b192-9425-4ca0-99c9-3ebd88ddd16b';
const flagKey = 'htpr-9369-view-empty-columns';

const errors = load('src/lib/mcp-server/utils/errors.ts');

function viewOperations({ enabled, body }) {
  const writes = [];
  const flagCalls = [];
  const save = async input => {
    writes.push(input);
    return { id: viewId, board_empty_sections: input.board_empty_sections };
  };
  const stubs = {
    '@/lib/flags': {
      isFeatureEnabled: async (key, userId) => {
        flagCalls.push({ key, userId });
        return enabled;
      },
    },
    '@/lib/flags/definitions/htpr-9369-view-empty-columns': {
      HTPR_9369_VIEW_EMPTY_COLUMNS_FLAG: flagKey,
    },
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': {},
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 } }),
      readMcpRouteJsonBody: async () => ({ ok: true, body }),
    },
    '@/lib/prisma': {},
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/lib/mcp/views/services': { createView: save, updateView: save },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/models/Views/model': { isSubtaskSetting: () => true },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
    '@/lib/mcp/views/viewRefusal': load('src/lib/mcp/views/viewRefusal.ts', {
      '@/lib/mcp-server/utils/errors': errors,
    }),
    '@/lib/mcp-server/utils/errors': errors,
  };
  return {
    writes,
    flagCalls,
    create: () => load('src/lib/mcp/operations/view/operation.ts', stubs).POST(
      new NextRequest('https://app.hypertask.ai/api/mcp/view', { method: 'POST' }),
    ),
    update: () => load('src/lib/mcp/operations/view/[viewId]/operation.ts', stubs).PATCH(
      new NextRequest(`https://app.hypertask.ai/api/mcp/view/${viewId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ viewId }) },
    ),
  };
}

test('a view can be created with empty columns hidden', () => {
  const { CreateViewInputSchema } = load('src/lib/mcp-server/validations/view.validation.ts');
  const parsed = CreateViewInputSchema.safeParse({
    project_id: 15,
    title: 'Hide empty columns',
    board_empty_sections: 'Hidden',
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.board_empty_sections, 'Hidden');
  assert.equal(
    CreateViewInputSchema.safeParse({
      project_id: 15,
      title: 'Bad empty columns',
      board_empty_sections: 'Hide',
    }).success,
    false,
  );
});

test('a view can be updated with the empty-column setting alone', () => {
  const { getUpdateViewInputSchema } = load('src/lib/mcp-server/validations/view.validation.ts');
  const schema = getUpdateViewInputSchema();
  const parsed = schema.safeParse({ viewId, board_empty_sections: 'Hidden' });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.board_empty_sections, 'Hidden');
  assert.equal(schema.safeParse({ viewId, board_empty_sections: 'Hide' }).success, false);
});

test('creating a view keeps empty columns hidden for an enabled caller', async () => {
  const f = viewOperations({
    enabled: true,
    body: { project_id: 15, title: 'Hide empty columns', board_empty_sections: 'Hidden' },
  });

  const response = await f.create();

  assert.equal(response.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].board_empty_sections, 'Hidden');
  assert.deepEqual(f.flagCalls, [{ key: flagKey, userId: 985 }]);
});

test('creating a view ignores the empty-column setting when the flag is off', async () => {
  const f = viewOperations({
    enabled: false,
    body: { project_id: 15, title: 'Hide empty columns', board_empty_sections: 'Hidden' },
  });

  const response = await f.create();

  assert.equal(response.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].board_empty_sections, undefined);
});

test('updating a view keeps empty columns hidden for an enabled caller', async () => {
  const f = viewOperations({ enabled: true, body: { board_empty_sections: 'Hidden' } });

  const response = await f.update();

  assert.equal(response.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].board_empty_sections, 'Hidden');
  assert.deepEqual(f.flagCalls, [{ key: flagKey, userId: 985 }]);
});

test('updating a view ignores the empty-column setting when the flag is off', async () => {
  const f = viewOperations({ enabled: false, body: { board_empty_sections: 'Hidden' } });

  const response = await f.update();

  assert.equal(response.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].board_empty_sections, undefined);
});
