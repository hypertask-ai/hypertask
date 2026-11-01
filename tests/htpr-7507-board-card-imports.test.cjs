const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const extensions = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

function resolveSource(specifier, fromFile) {
  const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(fromFile), specifier) : null;
  if (!base) return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return extensions.map(ext => base + ext).find(candidate => fs.existsSync(candidate)) || null;
}

function runtimeImports(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const specifiers = [];
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier) {
      const clause = ts.isImportDeclaration(statement) ? statement.importClause : null;
      if (clause?.isTypeOnly || (ts.isExportDeclaration(statement) && statement.isTypeOnly)) continue;
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function staticGraph(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      const resolved = resolveSource(specifier, file);
      if (resolved) pending.push(resolved);
    }
  }
  return [...seen].map(file => path.relative(root, file));
}

const boardCardRow = path.join(root, 'src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx');

test('board card tags row does not load the ticket time panel or the time log modal at startup', () => {
  const graph = staticGraph(boardCardRow);
  assert.ok(!graph.includes('src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime.tsx'), 'TaskTime.tsx reached from the board card');
  assert.ok(!graph.includes('src/components/Modals/TimeLog/TimeLogModal.tsx'), 'TimeLogModal.tsx reached from the board card');
});

test('board card tags row keeps the same running timer helpers the ticket panel uses', () => {
  const imports = runtimeImports(boardCardRow);
  assert.ok(imports.includes('@/lib/timeDuration'));
  assert.ok(imports.includes('@/hooks/Task Detail/useTimeTracking'));
});
