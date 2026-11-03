const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { loadModule } = require('./helpers/loadModule.cjs');

const root = path.resolve(__dirname, '..');
const homepage = 'src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx';
const card = 'src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx';

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadDeclaration(name, file, env) {
  const parsed = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let text = null;
  const visit = (node) => {
    if (text) return;
    if (ts.isVariableDeclaration(node) && node.name?.getText(parsed) === name) {
      text = `const ${node.getText(parsed)};`;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(text, `${name} must stay declared in ${file}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-8427-'));
  try {
    const subject = path.join(dir, 'subject.ts');
    fs.writeFileSync(subject, `const {${Object.keys(env).join(',')}} = require('test-env');\n${text}\nexport const subject = ${name};`);
    return loadModule(subject, { 'test-env': env }).subject;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function board(flagOn) {
  const archived = [];
  const sections = [{ sectionId: 3, section_title: 'Bugs', items: [{ id: 41 }, { id: 42 }] }];
  const latestRef = {
    current: {
      _sections: sections,
      sections,
      displaySections: sections,
      archiveFocusOrder: true,
      _currentProject: { id: 15 },
      removeFromListWithStatus: async (sectionId, projectId, id, status) => archived.push({ sectionId, projectId, id, status }),
    },
  };
  const markAsDone = loadDeclaration('markAsDone', homepage, {
    latestRef,
    lastgClick: { current: Date.now() - 1000 },
    updateParentTask() {},
    useCallback: (callback) => callback,
    archiveShortcutAlwaysRuns: flagOn,
  });
  return { archived, markAsDone };
}

test('HTPR-8427 archive is a reversible bugfix for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8427-kanban-archive-shortcut.ts');
  assert.equal(flag.key, 'htpr-8427-kanban-archive-shortcut');
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('a card archive right after a G press still archives', async () => {
  const { archived, markAsDone } = board(true);
  await markAsDone('Bugs', 41);
  assert.deepEqual(archived, [{ sectionId: 3, projectId: 15, id: 41, status: 'Archive' }]);
});

test('two archives in a row both reach the board', async () => {
  const { archived, markAsDone } = board(true);
  await markAsDone('Bugs', 41);
  await markAsDone('Bugs', 42);
  assert.deepEqual(archived.map((entry) => entry.id), [41, 42]);
});

test('the flag off keeps the previous guard, so the release rolls back', async () => {
  const { archived, markAsDone } = board(false);
  await markAsDone('Bugs', 41);
  assert.deepEqual(archived, []);
});

test('a held archive key still archives only once', () => {
  const source = read(card);
  const start = source.indexOf('taskShortcutAction === "archive"');
  const branch = source.slice(start, source.indexOf('taskShortcutAction === "size"', start));
  assert.ok(start >= 0, 'the kanban archive shortcut must exist');
  assert.ok(
    branch.indexOf('shouldRunArchiveShortcut(') < branch.indexOf('markAsDone('),
    'held-key repeats must be stopped before the archive runs',
  );
});
