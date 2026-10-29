const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const os = require('node:os');
const { loadModule } = require('./helpers/loadModule.cjs');
const { JSDOM } = require('jsdom');
const jiti = require('jiti')(__filename);
const { nextFocusAfterRemoval } = jiti('../src/utils/helperFunctions/focusAfterRemoval.ts');

function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function compile(text, env, result) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-focus-'));
  const filename = path.join(dir, 'subject.ts');
  try {
    fs.writeFileSync(filename, `const {${Object.keys(env).join(',')}} = require('test-env');\n${text}\nexport const result = ${result};`);
    return loadModule(filename, { 'test-env': env }).result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function load(names, file, env) {
  const src = source(file);
  const declarations = [];
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && names.includes(node.name?.getText(src))) {
      declarations.push(ts.isFunctionDeclaration(node) ? node.getText(src) : `const ${node.getText(src)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(src);
  assert.equal(declarations.length, names.length);
  return compile(declarations.join('\n'), env, `{${names.join(',')}}`);
}

function fixture(enabled = true, visibleIds = [1, 3, 5]) {
  const dom = new JSDOM('<div class="section-container" tabindex="-1"><div id="droppable-section-container-11"></div></div>');
  const document = dom.window.document;
  const column = document.querySelector('.section-container');
  const list = document.getElementById('droppable-section-container-11');
  let sections = [{ sectionId: 11, section_title: 'Done', items: [1, 2, 3, 4, 5].map(id => ({ id })) }, { sectionId: 12, section_title: 'AI Review', items: [{ id: 99 }] }];
  if (visibleIds.length > 5) sections[0].items = Array.from({ length: visibleIds.at(-1) }, (_, index) => ({ id: index + 1 }));
  let active = visibleIds[0];
  const archived = [];
  const undo = [];
  const display = () => sections.map(s => ({ ...s, items: s.items.filter(t => visibleIds.includes(t.id) || t.id === 99) }));
  const render = () => {
    for (const element of [...list.children]) if (!display()[0].items.some(t => element.id === `task-${t.id}`)) element.remove();
    for (const task of display()[0].items) {
      if (!document.getElementById(`task-${task.id}`)) {
        const card = document.createElement('div'); card.id = `task-${task.id}`; card.tabIndex = 0; list.append(card);
      }
    }
    document.getElementById(`task-${active}`)?.focus();
  };
  render();
  const env = {
    archiveColumnBoundary: true, nextFocusAfterRemoval, document,
    updateActiveItemAndItemInView: id => { active = id; },
    _currentProject: { id: 7049 }, _currentUser: { id: 985 }, dedupe: false,
    getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [{ sections, filteredSections: sections, tasks: sections.flatMap(s => s.items) }] }, projectToUpdateIndex: 0 }),
    returnSortedItems: items => items,
    mutationHandler: (_index, updated) => { sections = updated; render(); },
    globalAPIHandlers: { archiveTask: async id => archived.push(id) },
    deleteTodo: (_message, data) => undo.push(data), toast() {}, queryClient: { refetchQueries: async () => {} },
  };
  const { removeFromListWithStatus } = load(['reAdjustFocusFromCurrContext', 'removeFromListWithStatus'], 'src/hooks/MultiPages/useUpdateTaskInBoards.tsx', env);
  const latestRef = { current: {} };
  const { markAsDone } = load(['markAsDone'], 'src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx', {
    latestRef, lastgClick: { current: null }, updateParentTask() {}, useCallback: callback => callback,
  });
  return {
    document, column, archived, undo, active: () => active, sections: () => sections,
    focus(id) { active = id; document.getElementById(`task-${id}`)?.focus(); },
    async press() {
      if (active == null) return;
      const section = sections.find(s => s.items.some(t => t.id === active));
      latestRef.current = { _sections: sections, sections, displaySections: display(), archiveFocusOrder: enabled, _currentProject: { id: 7049 }, removeFromListWithStatus };
      await markAsDone(section.section_title, active);
    },
  };
}

test('archive dispatch follows visible cards, not hidden cached neighbors', async () => {
  const f = fixture();
  for (const expected of [3, 5, null]) {
    await f.press();
    assert.equal(f.active(), expected);
    assert.equal(f.document.activeElement, expected == null ? f.column : f.document.getElementById(`task-${expected}`));
  }
  assert.deepEqual(f.archived, [1, 3, 5]);
  assert.deepEqual(f.sections()[0].items.map(t => t.id), [2, 4]);
  assert.deepEqual(f.sections()[1].items.map(t => t.id), [99]);
  assert.deepEqual(f.undo.map(t => t.id), [1, 3, 5]);
});

test('fourteen archives retain visible order and finish on the column', async () => {
  const ids = Array.from({ length: 14 }, (_, index) => index * 2 + 1);
  const f = fixture(true, ids);
  for (let i = 0; i < ids.length; i++) {
    assert.equal(f.active(), ids[i]);
    await f.press();
    assert.equal(f.active(), ids[i + 1] ?? null);
  }
  assert.deepEqual(f.archived, ids);
  assert.equal(f.document.activeElement, f.column);
  assert.deepEqual(f.sections()[1].items.map(t => t.id), [99]);
});

test('archiving the last visible card selects the one immediately above', async () => {
  const f = fixture(); f.focus(5); await f.press();
  assert.equal(f.active(), 3);
  assert.deepEqual(f.archived, [5]);
  assert.equal(f.undo[0].id, 5);
  assert.equal(f.undo[0].status, 'Archive');
});

test('flag off retains the old hidden-card focus path', async () => {
  const f = fixture(false); await f.press();
  assert.equal(f.active(), 2);
  assert.deepEqual(f.archived, [1]);
});

for (const enabled of [true, false]) {
  test(`first-card refresh ${enabled ? 'preserves empty-column focus' : 'keeps legacy fallback when off'}`, () => {
    const src = source('src/hooks/Homepage/useHandleKeyDownOperations.ts');
    let callback;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(src) === 'useEffect' && node.arguments[0]?.getText(src).includes('const elementToActivate')) callback = node.arguments[0].getText(src);
      ts.forEachChild(node, visit);
    }
    visit(src); assert.ok(callback);
    const dom = new JSDOM('<div class="section-container" tabindex="-1"></div><div id="task-99" tabindex="0"></div>');
    const document = dom.window.document;
    document.querySelector('.section-container').focus();
    const selected = [];
    compile(`const effect = ${callback};`, {
      document, archiveFocusOrder: enabled,
      showBoardManager: false, showCommands: { show: false }, showSaveModal: false, showSearchTasks: false,
      returnIfModalOrInputActive: () => false, getActiveItem: () => null,
      firstTask: { id: 99 }, _currentProject: { id: 7049 },
      getActiveSection: () => 0, setActiveSection() {}, spaceship: { refocus() {} },
      updateActiveItemAndItemInView: id => selected.push(id),
    }, 'effect')();
    assert.equal(document.activeElement.id, enabled ? '' : 'task-99');
    assert.deepEqual(selected, enabled ? [] : [99]);
  });
}

test('focus flag is reversible and restores intended behavior for everyone', () => {
  const flag = jiti('../src/lib/flags/definitions/htpr-8149-archive-focus-order.ts').default;
  assert.equal(flag.key, 'htpr-8149-archive-focus-order');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
});
