const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(__filename);
const { nextFocusAfterRemoval } = jiti(path.join(root, 'src/utils/helperFunctions/focusAfterRemoval.ts'));

function handlers(env) {
  const file = 'src/hooks/MultiPages/useUpdateTaskInBoards.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['reAdjustFocusFromCurrContext', 'removeFromListWithStatus'];
  const declarations = new Map();
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && names.includes(node.name?.getText(source))) {
      declarations.set(node.name.getText(source), ts.isFunctionDeclaration(node) ? node.getText(source) : `const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(declarations.size, names.length);
  const compiled = ts.transpileModule([...declarations.values()].join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), `${compiled}\nreturn {${names.join(',')}};`)(...Object.values(env));
}

function fixture(enabled = true) {
  let sections = [{ sectionId: 11, items: [{ id: 1 }, { id: 2 }] }, { sectionId: 12, items: [{ id: 3 }] }];
  let active = 1;
  const archived = [];
  const undo = [];
  const env = {
    archiveColumnBoundary: enabled, nextFocusAfterRemoval,
    updateActiveItemAndItemInView: id => { active = id; },
    _currentProject: { id: 15 }, _currentUser: { id: 985 }, dedupe: false,
    getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [{ sections, filteredSections: sections, tasks: sections.flatMap(s => s.items) }] }, projectToUpdateIndex: 0 }),
    returnSortedItems: items => items,
    mutationHandler: (_index, updated) => { sections = updated; },
    globalAPIHandlers: { archiveTask: async id => archived.push(id), deleteTaskAPI: async () => {} },
    deleteTodo: (_message, data) => undo.push(data), toast() {}, queryClient: { refetchQueries: async () => {} },
  };
  const { removeFromListWithStatus, reAdjustFocusFromCurrContext } = handlers(env);
  return {
    archived, undo, sections: () => sections, active: () => active,
    async press() {
      if (active == null) return;
      const section = sections.find(s => s.items.some(t => t.id === active));
      await removeFromListWithStatus(section.sectionId, 15, active, 'Archive');
    },
    moveFocus: args => reAdjustFocusFromCurrContext({ sections, projectId: 15, ...args }),
  };
}

test('repeated archive exhausts Done without moving focus or archiving AI Review', async () => {
  const f = fixture();
  for (let press = 0; press < 5; press++) await f.press();
  assert.deepEqual(f.archived, [1, 2]);
  assert.equal(f.active(), null);
  assert.deepEqual(f.sections()[1].items, [{ id: 3 }]);
  assert.deepEqual(f.undo.map(row => row.id), [1, 2]);
});

test('single archive keeps the next card in Done and registers its existing undo', async () => {
  const f = fixture(); await f.press();
  assert.deepEqual(f.archived, [1]);
  assert.equal(f.active(), 2);
  assert.equal(f.undo[0].status, 'Archive');
  assert.equal(f.undo[0].id, 1);
});

test('flag off preserves the old cross-column fallback', async () => {
  const f = fixture(false);
  for (let press = 0; press < 3; press++) await f.press();
  assert.deepEqual(f.archived, [1, 2, 3]);
});

test('moving a card retains the existing neighboring-column fallback', () => {
  const f = fixture();
  f.moveFocus({ sectionIndex: 1, itemIndex: 0, sectionId: 12, scope: 'board' });
  assert.equal(f.active(), 2);
});
