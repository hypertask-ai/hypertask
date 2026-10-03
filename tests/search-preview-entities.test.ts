import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createJiti } from 'jiti'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parse } from 'node-html-parser'
import { highlightedSearchSnippet } from '../src/lib/search/autocomplete'
import { parseSearchQuery } from '../src/lib/search/operators'

const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '..')
let taskRows: any[] = []
let commentRows: any[] = []
let databaseRows: any[] = []
let highlights = false
const flags = {
  HTPR_6369_SEARCH_OPERATORS_FLAG: 'operators', HTPR_6370_SEARCH_CHIPS_FLAG: 'chips',
  HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG: 'autocomplete', HTPR_6865_SEARCH_LAYOUT_FLAG: 'layout',
  HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG: 'highlights',
  isFeatureEnabled: async (flag: string) => flag === 'highlights' ? highlights : ['operators', 'chips', 'autocomplete', 'layout'].includes(flag),
}
for (const [file, exports] of [
  ['src/lib/prisma.ts', { default: {
    project: { findMany: async () => [{ id: 15 }] },
    task: { findMany: async () => databaseRows },
  } }],
  ['src/lib/turbopuffer.js', {
    turbopufferNamespaces: { task: { name: 'tasks' }, comment: { name: 'comments' } },
    default: { namespace: (name: string) => ({ query: async () => ({ rows: name === 'tasks' ? taskRows : commentRows }) }) },
  }],
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => ({ userId: 6 }) }],
  ['src/lib/flags.ts', flags],
  ['src/utils/controllers/projects/getAllIncludes.ts', { projectContentAccessWhere: () => ({}) }],
  ['src/lib/search/serverOperators.ts', { parseSearchWithChipNames: async (query: string) => parseSearchQuery(query) }],
  ['src/lib/search/filters.ts', { searchFilterWhere: async () => ({}) }],
] as const) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule
}
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })
const helper = jiti(path.join(root, 'src/utils/controllers/turbopuffer/turbopufferHelper.ts')) as typeof import('../src/utils/controllers/turbopuffer/turbopufferHelper')
const { turbopufferGetDocuments } = jiti(path.join(root, 'src/utils/controllers/search/document.ts')) as typeof import('../src/utils/controllers/search/document')
const handler = jiti(path.join(root, 'src/pages/api/search/document.ts')).default as any

// Compile the actual row JSX without loading unrelated app providers and hooks.
const source = fs.readFileSync(path.join(root, 'src/app/search/SearchComp.tsx'), 'utf8')
const ast = ts.createSourceFile('SearchComp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const row = ast.statements.find((statement) => ts.isVariableStatement(statement) &&
  statement.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === 'TaskListRow'))!
assert.ok(row, 'production search row exists')
const compiled = ts.transpileModule(`${row.getText(ast)}\nmodule.exports = TaskListRow`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const sandbox = {
  module: { exports: {} }, exports: {}, require, styles: {}, cn: () => '',
  formatDateDifference: () => '', Check: () => null,
  LabelWrapper: ({ children }: { children: React.ReactNode }) => children,
}
vm.runInNewContext(compiled, sandbox)
const TaskListRow = sandbox.module.exports as React.ComponentType<any>
function renderRow(task: any, query: string, clientHighlights: boolean) {
  return parse(renderToStaticMarkup(React.createElement(TaskListRow, {
    task, highlight: task.highlight, index: 0, isActive: false, liRef: { current: null },
    ...(clientHighlights ? { snippetParts: highlightedSearchSnippet(task.commentId ? task.commentText : task.descriptionText, query) } : {}),
  })))
}

const encoded = 'Eirini&#x27;s &quot;lab&quot; &amp; &lt; 3 &amp;quot; &nbsp; &#128512;'
const plain = 'Eirini\'s "lab" & < 3 &quot; \u00a0 😀'
function fixtures(text = encoded) {
  taskRows = [{ id: '1', title: 'Task', descriptionText: text, projectId: 15, status: 'Normal', ticketNumber: 'HTPR-1', uniqueIndex: 1, projectTitle: 'Board' }]
  commentRows = [{ id: '3', taskId: '2', commentText: text, projectId: 15, taskProjectId: 15, taskTitle: 'Comment task', taskStatus: 'Normal', taskTicketNumber: 'HTPR-2', taskUniqueIndex: 2, taskProjectTitle: 'Board' }]
  databaseRows = [1, 2].map((id) => ({ id, projectId: 15, title: 'Task', project: { title: 'Board' }, status: 'Normal', description_: { content: `<p>${text}</p>` } }))
}
async function filtered(query: string) {
  const response = { code: 0, body: undefined as any, status(code: number) { this.code = code; return this }, json(body: any) { this.body = body; return this } }
  await handler({ method: 'POST', headers: {}, body: { searchQuery: query, projectIds: [15], archive: 'Normal' } }, response)
  assert.equal(response.code, 200)
  return response.body.processedData.All as any[]
}

for (const query of ['lab', 'unmatched']) {
  for (const clientHighlights of [false, true]) {
    test(`task and comment entities decode once: ${query}, client highlights ${clientHighlights}`, async () => {
      fixtures()
      const result = await turbopufferGetDocuments(query, [15], 'Normal')
      assert.equal(result.status, 200)
      assert.equal((result.processedData.All as any[]).length, 2)
      for (const task of result.processedData.All as any[]) {
        assert.equal(task.commentId ? task.commentText : task.descriptionText, plain)
        const rendered = renderRow(task, query, clientHighlights)
        assert.ok(rendered.text.includes(plain), rendered.text)
        assert.equal(rendered.querySelectorAll('mark').length, query === 'lab' ? 1 : 0)
      }
    })
  }
}

test('filtered ranked descriptions and comments decode once, with highlights on and off', async () => {
  for (const enabled of [false, true]) {
    highlights = enabled
    fixtures()
    const tasks = await filtered('lab from:6')
    assert.equal(tasks[0].descriptionText, plain)
    if (enabled) assert.equal(tasks[1].commentText, plain)
    for (const task of tasks) assert.ok(renderRow(task, 'lab', enabled).text.includes(plain))
  }
})

test('operator-only fallback strips HTML before decoding entities once', async () => {
  for (const enabled of [false, true]) {
    highlights = enabled
    fixtures()
    const tasks = await filtered('from:6')
    assert.equal(tasks[0].descriptionText, plain)
    assert.ok(renderRow(tasks[0], 'from:6', enabled).text.includes(plain))
  }
})

test('literal image markup in descriptions and comments renders as text in every snippet path', async () => {
  const attack = '<img src=x onerror=alert(1)>'
  const stored = '&lt;img src=x onerror=alert(1)&gt;'
  assert.equal(parse(attack).querySelectorAll('img').length, 1, 'positive control detects real HTML')
  for (const commentId of [undefined, 3]) {
    const rendered = renderRow({ taskId: 1, commentId, descriptionText: attack, commentText: attack, highlight: {} }, 'unmatched', false)
    assert.equal(rendered.querySelectorAll('img').length, 0)
    assert.ok(rendered.text.includes(attack))
  }
  for (const query of ['img', 'unmatched', 'onerror']) {
    fixtures(stored)
    const result = await turbopufferGetDocuments(query, [15], 'Normal')
    for (const task of result.processedData.All as any[]) {
      for (const clientHighlights of [false, true]) {
        const rendered = renderRow(task, query, clientHighlights)
        assert.equal(rendered.querySelectorAll('img').length, 0)
        assert.ok(rendered.text.includes(attack), rendered.toString())
      }
    }
  }
  for (const enabled of [false, true]) {
    highlights = enabled
    fixtures(stored)
    const tasks = await filtered('from:6')
    const rendered = renderRow(tasks[0], 'from:6', enabled)
    assert.equal(rendered.querySelectorAll('img').length, 0)
    assert.ok(rendered.text.includes(attack))
  }
})

test('server highlights match visible text, not generated escape sequences', async () => {
  fixtures(`${encoded} amp quot lt 39`)
  const result = await turbopufferGetDocuments('amp quot lt 39', [15], 'Normal')
  for (const task of result.processedData.All as any[]) {
    const rendered = renderRow(task, 'amp quot lt 39', false)
    assert.ok(rendered.text.includes(`${plain} amp quot lt 39`), rendered.text)
    assert.deepEqual(rendered.querySelectorAll('mark').map((mark) => mark.text), ['quot', 'amp', 'quot', 'lt', '39'])
  }
})

test('index writes retain one entity layer so repeated reads never double-decode', () => {
  assert.equal(helper.convertToPlain(`<p>${encoded}</p>`), encoded)
})
