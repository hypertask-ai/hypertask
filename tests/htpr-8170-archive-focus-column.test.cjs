const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { loadModule } = require('./helpers/loadModule.cjs');
const jiti = require('jiti')(__filename);
const { focusCandidates, focusRenderedCandidate, nextFocusAfterRemoval } = jiti('../src/utils/helperFunctions/focusAfterRemoval.ts');

function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function compile(text, env, result) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-focus-column-'));
  const filename = path.join(dir, 'subject.ts');
  try {
    fs.writeFileSync(filename, `const {${Object.keys(env).join(',')}} = require('test-env');\n${text}\nexport const result = ${result};`);
    return loadModule(filename, { 'test-env': env }).result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function load(name, file, env) {
  const src = source(file);
  let declaration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name?.getText(src) === name) declaration = `const ${node.getText(src)};`;
    ts.forEachChild(node, visit);
  }
  visit(src);
  assert.ok(declaration, `${name} exists in ${file}`);
  return compile(declaration, env, `{${name}}`)[name];
}

function fixture({ droppable = true, boundary = true } = {}) {
  const dom = new JSDOM(
    '<div id="sectionsContainer">' +
      `<div class="section-container" tabindex="-1">${droppable ? '<div id="droppable-section-container-11"></div>' : ''}` +
      '<div id="task-1" tabindex="0"></div></div>' +
      '<div class="section-container" tabindex="-1"><div id="droppable-section-container-12"></div><div id="task-9" tabindex="0"></div></div>' +
      '</div>',
  );
  const document = dom.window.document;
  globalThis.document = document;
  const [column] = document.querySelectorAll('.section-container');
  document.getElementById('task-1').focus();
  const focused = [];
  let activeId = 1;
  const reAdjustFocusFromCurrContext = load('reAdjustFocusFromCurrContext', 'src/hooks/MultiPages/useUpdateTaskInBoards.tsx', {
    nextFocusAfterRemoval, focusCandidates, focusRenderedCandidate,
    archiveColumnBoundary: boundary,
    updateActiveItemAndItemInView: (id) => {
      activeId = id;
      focused.push(id);
    },
  });
  return {
    document, column,
    active: () => activeId,
    focusCalls: () => focused,
    adjust: (sections, options = {}) =>
      reAdjustFocusFromCurrContext({
        sections,
        sectionIndex: options.sectionIndex ?? 0,
        projectId: 7049,
        sectionId: options.sectionId ?? 11,
        itemIndex: options.itemIndex ?? 0,
        scope: 'column',
        keepColumnFocus: options.keepColumnFocus ?? true,
      }),
  };
}

test('archiving the last visible card keeps focus on its column, never the first column', () => {
  const f = fixture();
  f.adjust([{ sectionId: 11, items: [{ id: 1 }] }, { sectionId: 12, items: [{ id: 9 }] }]);
  assert.equal(f.active(), null);
  assert.equal(f.document.activeElement, f.column);
  assert.notEqual(f.document.activeElement, f.document.getElementById('task-9'));
});

test('the column is found through its droppable node, not its card list', () => {
  const f = fixture();
  assert.equal(f.document.activeElement.id, 'task-1');
  f.adjust([{ sectionId: 11, items: [{ id: 1 }] }]);
  assert.equal(f.document.activeElement.classList.contains('section-container'), true);
  assert.equal(f.document.activeElement.id, '');
});

test('a column that is no longer rendered leaves focus alone instead of jumping', () => {
  const f = fixture({ droppable: false });
  f.adjust([{ sectionId: 11, items: [{ id: 1 }] }], { sectionId: 99 });
  assert.equal(f.document.activeElement.id, 'task-1');
});

test('a column with cards left keeps visible card order and does not take column focus', () => {
  const f = fixture();
  f.adjust([{ sectionId: 11, items: [{ id: 1 }, { id: 3 }] }, { sectionId: 12, items: [{ id: 9 }] }]);
  assert.equal(f.active(), 3);
  assert.deepEqual(f.focusCalls(), [3]);
  assert.equal(f.document.activeElement.id, 'task-1');
});

test('with the column-boundary rule off the helper keeps the old behaviour', () => {
  const f = fixture({ boundary: false });
  f.adjust([{ sectionId: 11, items: [{ id: 1 }] }], { keepColumnFocus: false });
  assert.equal(f.active(), null);
  assert.equal(f.document.activeElement.id, 'task-1');
});
