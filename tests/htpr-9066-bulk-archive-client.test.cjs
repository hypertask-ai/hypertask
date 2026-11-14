const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { loadModule } = require('./helpers/loadModule.cjs');
const source = ts.createSourceFile('Homepage.tsx', fs.readFileSync(path.join(__dirname, '../src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name, values) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(initializer, name);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-9066-'));
  const file = path.join(dir, 'initializer.tsx');
  try {
    fs.writeFileSync(file, `export default ({ ${Object.keys(values).join(', ')} }) => (${initializer.getText(source)});`);
    return loadModule(file).default(values);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const tasks = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, projectId: 15, sectionId: 10, title: `Card ${i}` }));
function display(overrides = {}) {
  return expression('displaySections', {
    useMemo: fn => fn(), _currentProject: { id: 15, timeTrackingEnabled: false },
    searchProjectId: null, searchKeyword: '', runningOnly: false, timerDataReady: false, runningTimers: new Set(),
    sectionsToDisplay: [{ sectionId: 10, items: [...tasks, { id: 100 }] }],
    bulkArchiveBatch: true, pendingBulkArchiveIds: new Set(tasks.map(t => t.id)), ...overrides,
  });
}
test('stale board data cannot resurrect 50 pending cards on ordinary or running-only boards', () => {
  assert.deepEqual(display()[0].items.map(t => t.id), [100]);
  assert.deepEqual(display({ runningOnly: true, timerDataReady: true, _currentProject: { id: 15, timeTrackingEnabled: true }, runningTimers: new Set([1, 100]) })[0].items.map(t => t.id), [100]);
  assert.equal(display({ bulkArchiveBatch: false })[0].items.length, 51);
  assert.equal(display({ pendingBulkArchiveIds: new Set() })[0].items.length, 51);
});

test('one batch request, exact failed cards, one successful Undo and pending hide through reconciliation', async () => {
  const calls = [], undos = [];
  let pending = new Set([999]), release, reconciling;
  const started = new Promise(resolve => { reconciling = resolve; });
  const reconcile = new Promise(resolve => { release = resolve; });
  const callback = expression('archiveSelectedBatchForBulk', {
    useCallback: fn => fn, _currentProject: { id: 15 }, currentUser: { id: 985 }, bulkArchiveBatch: true, queryClient: {},
    setPendingBulkArchiveIds: update => { pending = typeof update === 'function' ? update(pending) : update; },
    getBulkSourceSectionId: task => task.sectionId, removeFromListWithStatus: async () => {},
    axios: { post: async (url, body) => { calls.push([url, body]); return { data: { archivedIds: tasks.slice(0, 49).map(t => t.id) } }; } },
    refreshTaskDetailReadAfterWrite: () => {}, registerArchiveUndo: (text, data) => undos.push({ text, data }),
    reconcileActiveBoardTasks: async () => { reconciling(); await reconcile; },
  });
  const running = callback(tasks);
  await started;
  assert.equal(pending.size, 51);
  assert.deepEqual(calls, [['/api/tasks/bulk-archive', { ids: tasks.map(t => t.id), projectId: 15 }]]);
  release();
  assert.deepEqual((await running).map(t => t.id), [50]);
  assert.deepEqual([...pending], [999]);
  assert.equal(undos.length, 1);
  assert.deepEqual(undos[0].data.taskIds, tasks.slice(0, 49).map(t => t.id));
});

test('failed batch restores failure selection without an Undo or stuck pending IDs', async () => {
  let pending = new Set();
  let reconciled = false;
  const callback = expression('archiveSelectedBatchForBulk', {
    useCallback: fn => fn, _currentProject: { id: 15 }, currentUser: { id: 985 }, bulkArchiveBatch: true, queryClient: {},
    setPendingBulkArchiveIds: update => { pending = update(pending); },
    getBulkSourceSectionId: task => task.sectionId, removeFromListWithStatus: async () => {},
    axios: { post: async () => { throw Error('connection lost'); } },
    refreshTaskDetailReadAfterWrite: () => assert.fail('no confirmed archive'), registerArchiveUndo: () => assert.fail('no successful Undo'),
    reconcileActiveBoardTasks: async () => { reconciled = true; },
  });
  assert.deepEqual((await callback(tasks)).map(t => t.id), tasks.map(t => t.id));
  assert.equal(reconciled, true);
  assert.equal(pending.size, 0);
});
