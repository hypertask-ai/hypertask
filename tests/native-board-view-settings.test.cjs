const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const prismaPath = path.join(root, 'src/lib/prisma.ts');
const settingsPath = path.join(root, 'src/lib/mcp/views/nativeBoardSettings.ts');

function loadSettings(sections = []) {
  delete require.cache[settingsPath];
  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: {
      default: {
        section: {
          findMany: async (args) => {
            assert.equal(args.where.projectId, 15);
            assert.equal(args.where.deleted, false);
            return sections;
          },
        },
      },
    },
  };
  const jiti = require('jiti')(__filename, {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  });
  return jiti(settingsPath);
}

test('normalizes a bounded native filter projection', () => {
  const { normalizeNativeBoardFilters } = loadSettings();
  const result = normalizeNativeBoardFilters({
    matchFilters: 'ALL',
    addedFilters: [
      {
        type: 'Priority',
        match: 'ANY',
        searchPayload: [{ priority_index: 2, Priority_Value: 'High', ignored: 'drop me' }],
      },
      { type: 'Status', searchPayload: [{ value: 'Normal' }] },
    ],
    ignored: true,
  });
  assert.deepEqual(result, {
    matchFilters: 'ALL',
    addedFilters: [
      {
        type: 'Priority',
        match: 'ANY',
        searchPayload: [{ priority_index: 2, Priority_Value: 'High' }],
      },
      { type: 'Status', searchPayload: [{ value: 'Normal' }] },
    ],
  });
  assert.throws(
    () => normalizeNativeBoardFilters({ matchFilters: 'ANY', addedFilters: [{ type: 'Unknown', searchPayload: [] }] }),
    /unsupported filter type/,
  );
  assert.throws(
    () => normalizeNativeBoardFilters({
      matchFilters: 'ANY',
      addedFilters: [
        { type: 'Priority', searchPayload: [] },
        { type: 'Priority', searchPayload: [] },
      ],
    }),
    /duplicate Priority/,
  );
  assert.throws(
    () => normalizeNativeBoardFilters({
      matchFilters: 'ANY',
      addedFilters: [{ type: 'Assignees', searchPayload: [{ displayName: 'Unknown' }] }],
    }),
    /member or agent ids/,
  );
  assert.throws(
    () => normalizeNativeBoardFilters({
      matchFilters: 'ANY',
      addedFilters: [{ type: 'Assignees', searchPayload: [] }],
    }),
    /at least one assignee/,
  );
  assert.throws(
    () => normalizeNativeBoardFilters({
      matchFilters: 'ANY',
      addedFilters: [{ type: 'Status', match: 'ALL', searchPayload: [{ value: 'Normal' }] }],
    }),
    /only supports match 'ANY'/,
  );
  const invalidPayloads = [
    { type: 'Priority', searchPayload: [{ priority_index: 2, Priority_Value: 'Low' }] },
    { type: 'Size', searchPayload: [{ estimate_index: 99, estimate_value: 'XXL' }] },
    { type: 'Status', searchPayload: [{}] },
    { type: 'Status', searchPayload: [{ value: 'Unknown' }] },
    { type: 'DueDate', searchPayload: [{ dynamicRange: 'SOMEDAY' }] },
    { type: 'DueDate', searchPayload: [{ dynamicRange: 'OVERDUE', condition: 'ANY' }] },
    { type: 'DueDate', searchPayload: [{ dynamicRange: 'OVERDUE', selectedDate: '2026-08-13' }] },
    { type: 'DueDate', searchPayload: [{ fromDate: 'not-a-date', toDate: '2026-08-13' }] },
    { type: 'DueDate', searchPayload: [{ condition: 'ANY', selectedDate: '2026-08-13' }] },
    { type: 'DueDate', searchPayload: [{ fromDate: '2026-08-01', toDate: '2026-08-13', selectedDate: '2026-08-05' }] },
    { type: 'DueDate', searchPayload: [{ fromDate: '2026-08-01', toDate: '2026-08-13', condition: 'AFTER' }] },
    { type: 'DueDate', searchPayload: [{ selectedDate: '2026-08-13', fromDate: '2026-08-01' }] },
  ];
  for (const filter of invalidPayloads) {
    assert.throws(
      () => normalizeNativeBoardFilters({ matchFilters: 'ANY', addedFilters: [filter] }),
      /contains an invalid value/,
    );
  }
  for (const searchPayload of [
    [],
    [{ dynamicRange: 'TODAY' }, { dynamicRange: 'YESTERDAY' }],
  ]) {
    assert.throws(
      () => normalizeNativeBoardFilters({
        matchFilters: 'ANY',
        addedFilters: [{ type: 'DueDate', searchPayload }],
      }),
      /exactly one value/,
    );
  }

  assert.doesNotThrow(() => normalizeNativeBoardFilters({
    matchFilters: 'ANY',
    addedFilters: [
      { type: 'Size', searchPayload: [{ estimate_index: 6, estimate_value: 'XL' }] },
      { type: 'DueDate', searchPayload: [{ dynamicRange: 'NEXT_7_DAYS' }] },
    ],
  }));
});

test('canonicalizes visible columns from current board sections', async () => {
  const sections = [
    { id: 1, section_title: 'Inbox', projectId: 15, ranking: 'A', isDone: false, deleted: false },
    { id: 2, section_title: 'Done', projectId: 15, ranking: 'B', isDone: true, deleted: false },
  ];
  const { canonicalBoardColumns } = loadSettings(sections);
  const columns = await canonicalBoardColumns(15, [2]);
  assert.deepEqual(columns.map(({ id, title, visibility }) => ({ id, title, visibility })), [
    { id: 1, title: 'Inbox', visibility: false },
    { id: 2, title: 'Done', visibility: true },
  ]);
  const allHidden = await canonicalBoardColumns(15, []);
  assert.deepEqual(allHidden.map(({ id, visibility }) => ({ id, visibility })), [
    { id: 1, visibility: false },
    { id: 2, visibility: false },
  ]);
  await assert.rejects(() => canonicalBoardColumns(15, [999]), /does not belong/);
  await assert.rejects(() => canonicalBoardColumns(15, [true]), /positive integers/);
  await assert.rejects(() => canonicalBoardColumns(15, ['2']), /positive integers/);
});
