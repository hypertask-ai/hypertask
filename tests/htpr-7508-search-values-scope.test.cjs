const assert = require('node:assert/strict')
const test = require('node:test')
const { fixture, matches, hydrate } = require('./helpers/agent-board-scope.cjs')
const keys = require('./helpers/flag-files.cjs').load(require('node:path').resolve(__dirname, '../src/lib/flags/keys.ts'))

function lookupMatches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(part => lookupMatches(row, part))
    if (key === 'OR') return value.some(part => lookupMatches(row, part))
    if (key === 'NOT') return !lookupMatches(row, value)
    if (key === 'startsWith') return String(row ?? '').toLowerCase().startsWith(value.toLowerCase())
    if (value && typeof value === 'object' && !(value instanceof Date) && !['some', 'in', 'not', 'equals', 'contains', 'gte'].includes(key)) {
      return lookupMatches(row?.[key], value)
    }
    return matches(row, { [key]: value })
  })
}

function harness({ actor = 'agent', enforce = true, grant = 'none', authenticated = true, layout = true, bypassProducer = false } = {}) {
  const f = fixture()
  f.state.enforce = enforce
  if (actor !== 'agent') f.state.ctx.agentId = null
  f.projects.forEach(project => {
    project.members = []
    if (actor !== 'agent' && actor !== 'owner') {
      project.ownerId = 99
      project.owner = { id: 99, agents: [] }
      if (actor !== 'outsider') project.members.push({ userId: f.user.id, agentId: null, role: actor === 'guest' ? 'Guest' : 'Member', status: 'Accepted', user: f.user })
    }
  })
  const target = f.projects[2]
  if (grant !== 'none') {
    const project = grant === 'wrong-board' ? f.projects[0] : target
    project.members.push({ userId: f.user.id, agentId: f.agent.id, agent: f.agent, status: grant === 'invited' ? 'Invited' : 'Accepted' })
    if (grant === 'revoked') f.agent.revokedAt = new Date()
    if (grant === 'wrong-owner') f.agent.userId = 99
  }
  const labels = f.projects.map(project => ({ id: `label-${project.id}`, projectId: project.id, value: `Label ${project.id}` }))
  const people = f.projects.map(project => ({
    id: project.id, displayName: `Person ${project.id}`, email: `${project.id}@example.invalid`,
    members: [{ projectId: project.id }], tasks: [], assignees: [], comments: [],
  }))
  f.tasks.forEach(task => { task.createdAt = new Date(); task.userId = task.projectId })
  const queries = []
  function read(model, rows, args) {
    queries.push({ model, ...args })
    const selected = rows.filter(row => lookupMatches(row, args.where))
    return selected.slice(0, args.take ?? selected.length).map(row => hydrate(row, args))
  }
  f.prisma.project.findMany = async args => read('project', f.projects, bypassProducer ? { ...args, where: { status: 'Normal', ...f.access.getProjectWhere(f.user.id) } } : args)
  f.prisma.task.findMany = async args => read('task', f.tasks, args)
  f.prisma.user.findMany = async args => read('user', people, args)
  f.prisma.assignees = { findMany: async args => read('assignees', [], args) }
  f.prisma.label = { findMany: async args => read('label', labels, args) }
  f.prisma.taskLabel = { groupBy: async args => {
    queries.push({ model: 'taskLabel', ...args })
    return labels.filter(label => args.where.labelId.in.includes(label.id) && args.where.task.projectId.in.includes(label.projectId))
      .map(label => ({ labelId: label.id, _count: { _all: 1 } }))
  } }
  const handler = f.load('src/pages/api/search/values.ts', {
    '@/lib/auth/getSessionUser': { getSessionUser: async () => {
      if (!authenticated) return null
      await f.scope.prepareAgentScope(f.user.id, f.state.ctx.agentId)
      return { userId: f.user.id, agentId: f.state.ctx.agentId }
    } },
    '@/lib/flags': { ...keys, isFeatureEnabled: async key => {
      if (key === keys.HTPR_6865_SEARCH_LAYOUT_FLAG) return layout
      throw new Error(`Unexpected route flag: ${key}`)
    } },
  }).default
  async function request(operator = 'board', query = {}, method = 'GET') {
    const res = { status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
    await handler({ method, url: '/api/search/values', headers: {}, query: {
      operator, value: '', boardId: String(target.id), userId: '999', agentId: 'forged-agent', ...query,
    }, body: { userId: 999, agentId: 'forged-agent' } }, res)
    return res
  }
  return { ...f, target, people, labels, queries, request }
}

const operators = ['from', 'assignee', 'in', 'board', 'label', 'commenter']
const ids = [15, 4060, 2128]
function candidateIds(response) { return response.body.candidates.map(item => item.id).sort((a, b) => String(a).localeCompare(String(b))) }
function expectedIds(operator, boards) { return boards.map(id => operator === 'label' ? `label-${id}` : id).sort((a, b) => String(a).localeCompare(String(b))) }

for (const operator of operators) {
  test(`${operator}: zero-grant internal agent gets no candidates in ENFORCE`, async () => {
    const h = harness()
    const res = await h.request(operator)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { candidates: [] })
    assert.deepEqual(h.queries.map(query => query.model), ['project'])
    assert.equal(h.state.flagReads, 1)
  })

  test(`${operator}: same zero-grant agent keeps all legacy boards in WATCH`, async () => {
    const h = harness({ enforce: false })
    const res = await h.request(operator)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(candidateIds(res), expectedIds(operator, ids))
    assert.equal(h.state.flagReads, 1)
  })

  test(`${operator}: Accepted same-owner grant restricts results to its board in ENFORCE`, async () => {
    const h = harness({ grant: 'accepted' })
    assert.deepEqual(candidateIds(await h.request(operator)), expectedIds(operator, [h.target.id]))
  })

  for (const actor of ['owner', 'member', 'guest']) {
    test(`${operator}: human ${actor} retains all accessible boards, not only selected board`, async () => {
      const h = harness({ actor })
      const res = await h.request(operator)
      assert.equal(res.statusCode, 200)
      assert.deepEqual(candidateIds(res), expectedIds(operator, ids))
      assert.equal(h.state.flagReads, 0)
    })
  }
}

for (const grant of ['invited', 'revoked', 'wrong-owner']) {
  test(`${grant} does not confer agent access in ENFORCE`, async () => {
    const h = harness({ grant })
    assert.deepEqual((await h.request()).body, { candidates: [] })
  })
}

test('grant on another board cannot leak selected-board labels or people', async () => {
  for (const operator of operators) {
    const h = harness({ grant: 'wrong-board' })
    assert.deepEqual(candidateIds(await h.request(operator)), expectedIds(operator, [15]))
  }
})

test('accepted grant alone cannot widen legacy human board eligibility in either mode', async () => {
  for (const enforce of [false, true]) {
    const h = harness({ grant: 'accepted', enforce })
    h.projects.forEach(project => { project.ownerId = 99; project.owner = { id: 99, agents: [] } })
    assert.deepEqual((await h.request()).body, { candidates: [] })
  }
})

test('Normal status and existing team requirement remain conjunctive for humans and agents', async () => {
  for (const actor of ['owner', 'member', 'guest', 'agent']) {
    const h = harness({ actor, grant: 'accepted' })
    h.target.teamId = null
    h.projects[0].status = 'Archive'
    h.projects[1].status = 'Deleted'
    assert.deepEqual((await h.request()).body, { candidates: [] })
  }
})

test('non-member humans and empty board lists retain empty scope responses for all operators', async () => {
  for (const actor of ['outsider', 'owner']) {
    for (const operator of operators) {
      const h = harness({ actor })
      if (actor === 'owner') h.projects.splice(0)
      assert.deepEqual((await h.request(operator)).body, { candidates: [] })
      assert.deepEqual(h.queries.map(query => query.model), ['project'])
    }
  }
})

test('selected board is preferred, while invalid or inaccessible selection falls back to all eligible boards', async () => {
  for (const actor of ['owner', 'member', 'guest']) {
    for (const operator of operators) {
      const h = harness({ actor })
      const res = await h.request(operator)
      assert.equal(res.body.candidates[0].id, operator === 'label' ? `label-${h.target.id}` : h.target.id)
      for (const boardId of ['999', 'invalid', '']) {
        assert.deepEqual(candidateIds(await h.request(operator, { boardId })), expectedIds(operator, ids))
      }
    }
  }
})

test('label selected-board scope intersects eligible boards and preserves all-board fallback and counts', async () => {
  for (const actor of ['owner', 'member', 'guest']) {
    for (const [boards, expected] of [['15,2128,999', [15, 2128]], ['999', []], ['', ids], ['bad,-1', ids]]) {
      const h = harness({ actor })
      const res = await h.request('label', { boards })
      assert.deepEqual(candidateIds(res), expectedIds('label', expected))
      assert.ok(res.body.candidates.every(item => item.count === 1))
      assert.ok(res.body.candidates.every(item => item.byName === (!boards || boards === 'bad,-1' ? true : undefined)))
    }
  }
  const h = harness({ grant: 'accepted' })
  assert.deepEqual(candidateIds(await h.request('label', { boards: '15,2128,999' })), ['label-2128'])
})

test('layout flag off retains all eligible boards without label counts', async () => {
  const h = harness({ actor: 'owner', layout: false })
  const res = await h.request('label', { boards: '15,999' })
  assert.deepEqual(candidateIds(res), expectedIds('label', ids))
  assert.ok(res.body.candidates.every(item => item.count === undefined && item.byName === undefined))
})

test('people and legacy labels retain prefix, contains, fuzzy and exact-resolution branches within scope', async () => {
  for (const actor of ['owner', 'member', 'guest']) {
    for (const operator of ['from', 'assignee', 'commenter', 'label']) {
      for (const value of operator === 'label' ? ['label', 'abel', 'lb'] : ['person', 'erson', 'ps']) {
        const h = harness({ actor, layout: false })
        const name = operator === 'label' ? 'Label 2128' : 'Person 2128'
        const res = await h.request(operator, { value, resolve: `${name} trailing` })
        assert.equal(res.body.resolved, name)
        assert.deepEqual(candidateIds(res), expectedIds(operator, ids))
        assert.ok(h.queries.some(query => query.model === (operator === 'label' ? 'label' : 'user') && query.where.AND))
      }
    }
  }
  for (const operator of ['from', 'assignee', 'commenter', 'label']) {
    const h = harness({ grant: 'accepted', layout: false })
    assert.deepEqual(candidateIds(await h.request(operator, { value: operator === 'label' ? 'lb' : 'ps' })), expectedIds(operator, [2128]))
  }
})

test('board, label and person resolution cannot resolve outside agent grants', async () => {
  for (const [operator, resolve, expected] of [['board', 'Board 2128 tail', 'Board 2128'], ['label', 'Label 2128 tail', 'Label 2128'], ['from', 'Person 2128 tail', 'Person 2128']]) {
    const h = harness({ grant: 'accepted' })
    assert.equal((await h.request(operator, { resolve })).body.resolved, expected)
    assert.equal((await h.request(operator, { resolve: resolve.replace('2128', '15') })).body.resolved, undefined)
  }
})

test('recorded D76 task query itself rejects ungranted boards even if producer scope regresses', async () => {
  const h = harness({ grant: 'accepted', bypassProducer: true })
  await h.request('from')
  const query = h.queries.find(query => query.model === 'task')
  assert.ok(query)
  assert.deepEqual(query.where.projectId.in, [2128, 15, 4060])
  assert.ok(query.where.createdAt.gte instanceof Date)
  assert.deepEqual(query.select, { userId: true })
  assert.equal(query.take, 100)
  assert.deepEqual(query.orderBy, { createdAt: 'desc' })
  assert.equal(matches(h.tasks[2], query.where), true)
  assert.equal(matches(h.tasks[0], query.where), false)
  assert.equal(matches({ ...h.tasks[2], createdAt: new Date('2000-01-01') }, query.where), false)
  h.target.members = []
  assert.equal(matches(h.tasks[2], query.where), false)
})

test('method, authentication and operator errors retain exact status and body', async () => {
  const unauthenticated = harness({ authenticated: false })
  const unauthorized = await unauthenticated.request()
  assert.equal(unauthorized.statusCode, 401)
  assert.deepEqual(unauthorized.body, { error: 'Unauthorized' })
  const h = harness({ actor: 'owner' })
  const method = await h.request('board', {}, 'POST')
  assert.equal(method.statusCode, 405)
  assert.deepEqual(method.body, { error: 'Method not allowed' })
  const unknown = await h.request('unknown')
  assert.equal(unknown.statusCode, 400)
  assert.deepEqual(unknown.body, { error: 'Unknown operator' })
  assert.deepEqual(h.queries, [])
})

test('commenter values remain available with all remaining search flags off', async () => {
  const h = harness({ actor: 'owner', layout: false })
  const res = await h.request('commenter')
  assert.equal(res.statusCode, 200)
  assert.deepEqual(candidateIds(res), expectedIds('commenter', ids))
})

test('HTTP tagged-agent cookies remain refused before the handler in WATCH and ENFORCE', async () => {
  const { harness: proxyHarness } = require('./helpers/agent-cookie-bridge.cjs')
  for (const enforce of [false, true]) {
    const h = proxyHarness({ enforce })
    const res = await h.proxy(h.request('/api/search/values', { method: 'GET' }))
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'Agent cookies are only accepted on task bridge routes', code: 'AGENT_COOKIE_ROUTE' })
    assert.equal(h.calls.flags, 0)
  }
})
