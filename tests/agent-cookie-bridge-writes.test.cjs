const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')
const { sessionModules, load } = require('./helpers/agent-cookie-bridge.cjs')
const root = path.resolve(__dirname, '..')
const mintFiles = [
  'src/lib/mcp/tasks/services.ts', 'src/lib/mcp/tasks/updateTask.ts', 'src/lib/mcp/tasks/internalTaskWrite.ts',
  'src/lib/mcp/operations/drafts/[draft_id]/publish/operation.ts',
]
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
}
function bridgeFetches() {
  const queue = [...mintFiles]
  const visited = new Set()
  const found = []
  while (queue.length) {
    const file = queue.shift()
    if (visited.has(file)) continue
    visited.add(file)
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const bindings = new Map()
    const fetches = []
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const entries = bindings.get(node.name.text) ?? []
        entries.push(node)
        bindings.set(node.name.text, entries)
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text
        if (name.startsWith('.')) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), name + '.ts'))
          if (target.startsWith('src/lib/mcp/tasks/fields/')) queue.push(target)
        }
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'fetch') fetches.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    let activeCall
    function resolve(node) {
      const seen = new Set()
      while (node && ts.isIdentifier(node) && bindings.has(node.text)) {
        assert.equal(seen.has(node.text), false, 'cyclic source binding')
        seen.add(node.text)
        const declarations = bindings.get(node.text).filter(declaration => {
          let scope = declaration.parent
          while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent
          let ancestor = activeCall
          while (ancestor && ancestor !== scope) ancestor = ancestor.parent
          return ancestor && declaration.pos < activeCall.pos
        })
        assert.ok(declarations.length, `unresolved binding ${node.text} in ${file}`)
        node = declarations.at(-1).initializer
      }
      return node
    }
    function shape(node) {
      node = resolve(node)
      if (node && ts.isParenthesizedExpression(node)) return shape(node.expression)
      if (node && ts.isConditionalExpression(node)) return { ...shape(node.whenTrue), ...shape(node.whenFalse) }
      assert.ok(node && ts.isObjectLiteralExpression(node), `unresolved fetch options/headers in ${file}`)
      const result = {}
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) Object.assign(result, shape(prop.expression))
        else if (ts.isPropertyAssignment(prop)) result[prop.name.text ?? prop.name.getText(source)] = prop.initializer
        else assert.fail(`unsupported object property in ${file}`)
      }
      return result
    }
    for (const call of fetches) {
      activeCall = call
      const options = shape(call.arguments[1])
      const headers = shape(options.headers)
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'cookie')) continue
      const method = resolve(options.method)
      assert.ok(method && ts.isStringLiteral(method), `unresolved bridge method in ${file}`)
      const url = resolve(call.arguments[0])
      assert.ok(ts.isTemplateExpression(url) && url.templateSpans.length === 1, `unresolved bridge URL in ${file}`)
      const pathname = url.templateSpans[0].literal.text
      assert.ok(pathname.startsWith('/api/'), pathname)
      found.push({ file, method: method.text, pathname, redirect: resolve(options.redirect)?.text })
    }
  }
  assert.ok(visited.has('src/lib/mcp/tasks/fields/persist.ts'))
  return found
}

test('source sync traces all four agent mint sites and exact Cookie-bearing fetch tuples through persist/fields', () => {
  const actualMints = []
  for (const file of walk(path.join(root, 'src/lib/mcp')).filter(file => file.endsWith('.ts'))) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('signSession')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'signSession') {
        assert.match(node.arguments[0].getText(source), /agentId/)
        actualMints.push(path.relative(root, file))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(actualMints.sort(), [...mintFiles].sort())
  const calls = bridgeFetches()
  assert.equal(calls.length, 10)
  const { AGENT_COOKIE_BRIDGE_ROUTES } = load('src/lib/auth/agentCookieBridgeRoutes.ts', {})
  assert.deepEqual([...new Set(calls.map(call => `${call.method} ${call.pathname}`))].sort(), AGENT_COOKIE_BRIDGE_ROUTES.map(([method, pathname]) => `${method} ${pathname}`).sort())
})

test('every Cookie-bearing bridge fetch explicitly refuses automatic redirects', () => {
  for (const call of bridgeFetches()) assert.ok(['manual', 'error'].includes(call.redirect), `${call.file}: bridge fetch must not follow redirects`)
})

function fixture() {
  const { session, edge } = sessionModules()
  const user = { id: 7, email: 'fixture@example.invalid', displayName: 'Fixture', photoURL: null }
  const ctx = { user, agentId: 'bridge-agent' }
  const task = { id: 101, projectId: 15, sectionId: 10, status: 'Normal', title: 'Before', ticketNumber: 'HTPR-101', project: { ownerId: 7, members: [] } }
  const prisma = {
    user: { findUnique: async () => user },
    task: { findFirst: async () => null, findUnique: async () => task, findMany: async () => [task] },
    section: { findUnique: async () => ({ section_title: 'Review', projectId: 15 }) },
    agent: { findUnique: async () => ({ id: ctx.agentId }) },
    drafts: { findUnique: async () => ({ id: 1, type: 'Description', userId: 7, taskId: 101, content: '<p>Draft</p>', task }) },
    $transaction: async run => run(prisma),
  }
  const mocks = {
    '@/lib/prisma': { default: prisma }, '@/lib/auth/session': session,
    '@/lib/auth/agentScope': { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    '@/lib/telemetry/savedWork': { CREATION_CHANNEL_HEADER: 'x-creation-channel', CREATION_AGENT_HEADER: 'x-creation-agent' },
    '@/lib/agentWebhooks/outbox': {},
    '@/utils/controllers/activities/createLabelActivity': { default: async () => {} },
    '@/utils/controllers/urls/extractUrlsFromContent': { persistUrlsForDescription: async () => {} },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/utils/controllers/assignees/assign': { clearHumanAssignees: async () => {} },
    '@/utils/controllers/tasks/assertTaskAccess': { userCanAccessTask: async () => true },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async () => ({ id: 1 }) },
    './mappers': { taskDetailInclude: () => ({}) },
    '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), mapTaskToDetail: task => task },
    '@/lib/mcp/tasks/broadcastTaskUpdates': { broadcastTaskUpdates: async () => {} },
    '@/lib/mcp/tasks/agentMutationFence': { assertAgentAssignmentChangeAllowed: async () => {} },
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => ({ id: ctx.agentId }) },
    '@/lib/pullRequests/taskPullRequests': { linkTaskPullRequest: async () => {}, PullRequestLinkError: class extends Error {} },
    '@/lib/mcp/tasks/resolveTask': { TaskIdentifierOutOfRangeError: class extends Error {} },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: handler => handler, validateMcpRouteAuth: async () => ctx, checkMcpRouteRateLimit: async () => null },
  }
  return { session, edge, user, ctx, task, mocks }
}

async function throughGuard(t, f, run) {
  const outgoing = []
  const { isAgentCookieBridgeRequestAllowed: allowed } = load('src/lib/auth/agentCookieBridgeRoutes.ts', {})
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = new NextRequest(url, options)
    const claims = await f.edge.verifySessionEdge(request.cookies.get('ht_session')?.value)
    assert.equal(claims?.agentId, f.ctx.agentId)
    const tuple = `${request.method} ${request.nextUrl.pathname}`
    outgoing.push(tuple)
    assert.equal(allowed(claims, request.method, request.nextUrl.pathname), true, `proxy refused ${tuple}`)
    assert.ok(['manual', 'error'].includes(options.redirect), tuple)
    return Response.json({ success: true, newTask: f.task })
  })
  await run()
  return outgoing
}

for (const [name, changes, expected] of [
  ['title', { title: 'After' }, 'PUT /api/tasks/single'],
  ['due date', { due_date: '2026-10-06' }, 'POST /api/tasks/setDueDate'],
  ['priority', { priority: 2 }, 'POST /api/priority/setPriority'],
  ['estimate', { estimate: 2 }, 'POST /api/estimate/setEstimate'],
  ['move section', { sectionId: 20 }, 'PUT /api/tasks/moveTask'],
  ['archive', { status: 'Archive' }, 'POST /api/tasks/(un)archive'],
  ['unarchive', { status: 'Normal' }, 'POST /api/tasks/(un)archive'],
]) {
  test(`real updateTask.ts ${name} outgoing request is admitted by proxy decision`, async t => {
    const f = fixture()
    if (name === 'unarchive') f.task.status = 'Archive'
    const bridge = load('src/lib/mcp/tasks/updateTask.ts', f.mocks)
    const execute = bridge.executeTaskUpdate
    const outgoing = await throughGuard(t, f, async () => {
      const { response } = await execute({ request: new NextRequest('http://localhost/api/mcp/tasks/update'), ctx: f.ctx, requestBody: { task_id: 101, ...changes }, strictSideEffectFailures: true })
      assert.equal(response.status, 200, await response.clone().text())
      assert.equal((await response.json()).success, true)
    })
    assert.deepEqual(outgoing, [expected])
  })
}


test('real MCP create outgoing request is admitted by proxy decision', async t => {
  const f = fixture()
  const { createTask } = load('src/lib/mcp/tasks/services.ts', f.mocks)
  const outgoing = await throughGuard(t, f, async () => {
    const task = await createTask({ projectId: 15, title: 'Created', description: '', sectionId: 10, sectionTitle: 'Todo', userId: 7, priorityIndex: 0, estimateIndex: 0, projectUniqueIdentifier: 'HTPR', teamId: 'team', agentId: f.ctx.agentId, creationChannel: 'mcp' })
    assert.equal(task.id, 101)
  })
  assert.deepEqual(outgoing, ['POST /api/tasks/createGlobally'])
})

test('real MCP description draft publish outgoing request is admitted by proxy decision', async t => {
  const f = fixture()
  const { POST } = load('src/lib/mcp/operations/drafts/[draft_id]/publish/operation.ts', f.mocks)
  const outgoing = await throughGuard(t, f, async () => {
    const response = await POST(new NextRequest('http://localhost/api/mcp/drafts/1/publish', { method: 'POST' }), { params: Promise.resolve({ draft_id: '1' }) })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal((await response.json()).success, true)
  })
  assert.deepEqual(outgoing, ['PUT /api/tasks/single'])
})
