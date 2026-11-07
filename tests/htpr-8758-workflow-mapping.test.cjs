const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const { formatBoardWorkflowMapping, columnWorkflowRole } = load('src/lib/mcp/boards/workflowMapping.ts');

test('formatBoardWorkflowMapping lists titles with semantic roles', () => {
  const mapping = formatBoardWorkflowMapping([
    { section_title: 'In Progress', isDone: false },
    { section_title: 'QA', isDone: false },
    { section_title: 'Done', isDone: true },
  ]);
  assert.match(mapping, /In Progress \(in-progress\)/);
  assert.match(mapping, /QA \(human-review\)/);
  assert.match(mapping, /Done \(done\)/);
});

test('columnWorkflowRole respects isDone over title keywords', () => {
  assert.equal(columnWorkflowRole({ section_title: 'Shipped ideas', isDone: true }), 'done');
});
