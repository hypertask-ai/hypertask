const assert = require('node:assert/strict')
const test = require('node:test')
const { load } = require('./task-route-loader.cjs')

function matches(row, where) {
  if (!row) return false
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((part) => matches(row, part))
    if (key === 'AND') return value.every((part) => matches(row, part))
    const actual = row[key]
    if (value === null || typeof value !== 'object') return actual === value
    if ('in' in value) return value.in.includes(actual)
    if ('not' in value) return actual !== value.not
    if ('some' in value || 'none' in value) {
      return (!value.some || actual.some((item) => matches(item, value.some))) &&
        (!value.none || !actual.some((item) => matches(item, value.none)))
    }
    return matches(actual, value.is ?? value)
  })
}

function harness(options = {}) {
  const state = {
    enabled: true,
    userId: 42,
    actingAgentId: undefined,
    teamScope: undefined,
    attempts: 0,
    conflicts: 0,
    failWrite: false,
    beforeTransaction: undefined,
    ...options,
    agents: [{
      id: 'agent', userId: options.agentOwner ?? 42, revokedAt: options.revokedAt ?? null,
      archivedAt: options.archivedAt ?? null, boardHomeTeamId: options.boardHome ?? null, crossTeamHomeTeamId: options.home ?? null,
      crossTeamAccessGranted: options.crossTeamAccessGranted ?? options.home != null,
      credentialTeamId: options.credentialTeamId ?? null,
      credentialTeamAccessBinding: options.credentialTeamAccessBinding ?? null,
    }],
    teams: [
      { id: 'a', googleAccount: { userId: 42 }, members: [] },
      { id: 'b', googleAccount: { userId: 99 }, members: [{ userId: 42, status: 'Accepted' }] },
      { id: 'c', googleAccount: { userId: 99 }, members: [] },
    ],
    projects: [
      { id: 1, teamId: 'a', ownerId: 42, status: 'Normal' },
      { id: 2, teamId: 'b', ownerId: 42, status: 'Normal' },
      { id: 3, teamId: 'c', ownerId: 42, status: 'Normal' },
      { id: 4, teamId: 'a', ownerId: 42, status: 'Normal' },
      { id: 5, teamId: 'b', ownerId: 42, status: 'Normal' },
      { id: 6, teamId: null, ownerId: 42, status: 'Normal' },
    ],
    members: (options.members ?? [1]).map((projectId, i) => ({
      id: i + 10, projectId, agentId: 'agent', userId: options.agentOwner ?? 42, status: 'Accepted',
    })),
  }
  let inTransaction = false
  const team = (id) => state.teams.find((item) => item.id === id)
  const project = (id) => {
    const row = state.projects.find((item) => item.id === id)
    return row && { ...row, team: team(row.teamId), members: state.members.filter((item) => item.projectId === id) }
  }
  const agent = (row) => ({
    ...row,
    members: state.members.filter((item) => item.agentId === row.id)
      .sort((a, b) => a.id - b.id).map((item) => ({ ...item, project: project(item.projectId) })),
  })
  const member = (row) => ({ ...row, project: project(row.projectId), agent: agent(state.agents.find((item) => item.id === row.agentId) ?? {}), user: { id: row.userId } })
  const inside = () => assert.equal(inTransaction, true, 'authorization and grants must use transaction client')
  const write = () => { inside(); if (state.failWrite) throw new Error('write failed') }
  const tx = {
    project: { findFirst: async ({ where }) => {
      inside()
      return state.projects.map((item) => project(item.id)).find((item) => matches(item, where)) ?? null
    } },
    agent: {
      findFirst: async ({ where, select }) => {
        if (select.members) inside()
        return state.agents.map(agent).find((item) => matches(item, where)) ?? null
      },
      update: async ({ where, data }) => {
        inside()
        const row = state.agents.find((item) => item.id === where.id)
        Object.assign(row, data)
        return row
      },
      create: async ({ data }) => {
        write()
        const row = { id: 'created-agent', photoURL: null, revokedAt: null, archivedAt: null, crossTeamHomeTeamId: null, crossTeamAccessGranted: false, ...data }
        state.agents.push(row)
        return row
      },
    },
    member: {
      findFirst: async ({ where }) => { inside(); return state.members.map(member).find((item) => matches(item, where)) ?? null },
      findMany: async ({ where }) => { inside(); return state.members.map(member).filter((item) => matches(item, where)) },
      create: async ({ data }) => {
        write()
        if (state.failMemberWrite) throw new Error('grant failed')
        const row = { id: Math.max(0, ...state.members.map((item) => item.id)) + 1, status: 'Accepted', ...data }
        state.members.push(row)
        return member(row)
      },
      createMany: async ({ data }) => { write(); for (const row of data) await tx.member.create({ data: row }); return { count: data.length } },
      deleteMany: async ({ where }) => {
        inside()
        const before = state.members.length
        state.members = state.members.filter((item) => !matches(item, where))
        return { count: before - state.members.length }
      },
      delete: async ({ where }) => { inside(); state.members = state.members.filter((item) => item.id !== where.id) },
    },
    taskLease: { findFirst: async () => { inside(); return null } },
  }
  const prisma = {
    ...tx,
    $transaction: async (run, settings) => {
      assert.deepEqual(settings, { isolationLevel: 'Serializable' })
      state.attempts += 1
      await state.beforeTransaction?.(state)
      const snapshot = structuredClone({ agents: state.agents, members: state.members })
      inTransaction = true
      try {
        const result = await run(tx)
        if (state.conflicts > 0) { state.conflicts -= 1; throw { code: 'P2034' } }
        return result
      } catch (error) {
        Object.assign(state, snapshot)
        throw error
      } finally { inTransaction = false }
    },
  }
  const flags = load('src/lib/agents/crossTeam.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/flags': { isFeatureEnabled: async (key, userId) => {
      assert.equal(key, 'htpr-8084-cross-team-agents')
      assert.equal(userId, 42)
      inside()
      return state.enabled
    } },
  })
  const auth = {
    checkMcpRateLimit: async () => null,
    validateMcpAuth: async () => ({ user: { id: state.userId, email: 'test@example.com' }, agentId: state.actingAgentId, teamScope: state.teamScope }),
    createMcpToken: () => 'test-token',
    managementAgentTokenScope: (management) => management,
    agentTokenCredentialFields: () => ({ mcpTokenHash: 'test-hash' }),
  }
  const mocks = {
    '@/lib/prisma': { default: prisma },
    '@/lib/agents/crossTeam': flags,
    '@/lib/agents/publicAgent': { publicAgentSelect: { id: true } },
    '@/lib/agents/visibility': {},
    '@/lib/agents/runtimeState': {},
    '@/lib/mcp/agents/lifecycle': {},
    '@/lib/mcp/auth': auth,
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/auth/agentScope': { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (userId, actingAgentId, scope) => scope ? { teamId: scope.teamId } : {} },
    '@/utils/controllers/agents/ensureDefaultTeamAgent': { lockTeamAgentSeed: async () => inside() },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: state.userId }) },
    '@/lib/demo/guestGuard': { isGuestRequest: async () => false },
  }
  const cookie = load('src/pages/api/members/addAgent.ts', mocks).default
  const boards = load('src/utils/controllers/agents/boardMembers.ts', mocks)
  const updates = load('src/lib/mcp/agents/lifecycleRequests.ts', mocks)
  const create = load('src/lib/mcp/agents/create.ts', mocks)
  return {
    state,
    cookie: async (projectId = 2) => {
      const res = { status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
      await cookie({ method: 'POST', headers: { cookie: 'session=test' }, body: { projectId, agentId: 'agent' } }, res)
      return res
    },
    update: async (add = [2], remove = []) => updates.handlePatchAgentRequest({ json: async () => ({ add_project_ids: add, remove_project_ids: remove }) }, 'agent'),
    create: async (projectIds = [1, 2]) => create.handleCreateAgentRequest({ json: async () => ({ display_name: 'New agent', project_ids: projectIds }) }),
    createScoped: async (projectIds, scope) => create.createAgentForUser({ json: async () => ({ display_name: 'New agent', project_ids: projectIds }) }, { id: 42, email: 'test@example.com' }, scope),
    remove: (projectId) => boards.removeAgentFromBoard(projectId, 'agent', 42),
    directAdd: (projectId) => boards.addAgentToBoard(projectId, 'agent', 42, 'delegate'),
  }
}

for (const entry of ['cookie', 'update']) {
  test(`${entry}: own active agent enters an accepted member's team, recording original first team`, async () => {
    const h = harness()
    const response = await h[entry]()
    assert.equal(response.statusCode ?? response.status, 200)
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1, 2])
    assert.ok(h.state.members.every((row) => row.status === 'Accepted'))
  })

  for (const [name, options, target] of [
    ['foreign team despite board ownership', {}, 3],
    ['nonowner', { agentOwner: 99 }, 2],
    ['revoked agent', { revokedAt: new Date() }, 2],
    ['archived agent', { archivedAt: new Date() }, 2],
    ['bound credential outside team', { credentialTeamId: 'a', credentialTeamAccessBinding: 'owner:binding' }, 2],
    ['malformed bound credential', { credentialTeamAccessBinding: 'owner:binding' }, 2],
    ['flag disabled', { enabled: false }, 2],
    ['teamless board', {}, 6],
  ]) {
    test(`${entry}: refuses ${name} without changing grants or provenance`, async () => {
      const h = harness(options)
      const before = structuredClone({ agents: h.state.agents, members: h.state.members })
      const response = await h[entry](entry === 'cookie' ? target : [target])
      assert.ok((response.statusCode ?? response.status) >= 400)
      assert.deepEqual({ agents: h.state.agents, members: h.state.members }, before)
    })
  }

  test(`${entry}: pending team invitation and board-only guest both refuse expansion`, async () => {
    for (const members of [[{ userId: 42, status: 'Pending' }], []]) {
      const h = harness()
      h.state.teams[1].members = members
      const response = await h[entry]()
      assert.equal(response.statusCode ?? response.status, 403)
      assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
    }
  })

  test(`${entry}: board access is checked inside the transaction`, async () => {
    const h = harness({ beforeTransaction: (state) => { state.projects[1].ownerId = 99 } })
    const response = await h[entry]()
    assert.equal(response.statusCode ?? response.status, 403)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
  })

  test(`${entry}: serialization retries recheck current team access`, async () => {
    const h = harness({ conflicts: 1, beforeTransaction: (state) => {
      if (state.attempts === 2) state.teams[1].members = []
    } })
    const response = await h[entry]()
    assert.equal(response.statusCode ?? response.status, 403)
    assert.equal(h.state.attempts, 2)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
  })

  test(`${entry}: marker and grants retry atomically after serialization conflicts`, async () => {
    const h = harness({ conflicts: 2 })
    const response = await h[entry]()
    assert.equal(response.statusCode ?? response.status, 200)
    assert.equal(h.state.attempts, 3)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1, 2])
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
  })

  test(`${entry}: write failure rolls back first expansion marker`, async () => {
    const h = harness({ failWrite: true })
    const response = await h[entry]()
    assert.equal(response.statusCode ?? response.status, 500)
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
  })

  test(`${entry}: flag rollback retains provenance after all memberships disappear`, async () => {
    const h = harness()
    const expanded = await h[entry]()
    assert.equal(expanded.statusCode ?? expanded.status, 200)
    assert.equal((await h.remove(1)).ok, true)
    assert.equal((await h.remove(2)).ok, true)
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
    h.state.enabled = false
    const denied = await h[entry](entry === 'cookie' ? 5 : [5])
    assert.ok((denied.statusCode ?? denied.status) >= 400)
    const allowed = await h[entry](entry === 'cookie' ? 4 : [4])
    assert.equal(allowed.statusCode ?? allowed.status, 200)
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
    assert.deepEqual(h.state.members.map((row) => row.projectId), [4])
  })
}

test('MCP: rollout-off legacy replacement stays usable; enabled replacement becomes private', async () => {
  const off = harness({ enabled: false })
  assert.equal((await off.update([2], [1])).status, 200)
  assert.deepEqual(off.state.members.map((row) => row.projectId), [2])
  assert.equal(off.state.agents[0].crossTeamHomeTeamId, 'a')
  assert.equal(off.state.agents[0].crossTeamAccessGranted, false)
  assert.equal((await off.update([4], [2])).status, 200)
  assert.deepEqual(off.state.members.map((row) => row.projectId), [4])
  const on = harness()
  assert.equal((await on.update([2], [1])).status, 200)
  assert.deepEqual(on.state.members.map((row) => row.projectId), [2])
  assert.equal(on.state.agents[0].crossTeamHomeTeamId, 'a')
  assert.equal((await on.update([4], [2])).status, 200)
  assert.equal(on.state.agents[0].crossTeamHomeTeamId, 'a')
})

test('MCP: failed replacement rolls back removed membership and new provenance', async () => {
  const h = harness({ failWrite: true })
  assert.equal((await h.update([2], [1])).status, 500)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
})

test('delegated admissions refuse boards outside explicit acting-agent scope', async () => {
  const h = harness({ actingAgentId: 'delegate' })
  assert.equal((await h.update()).status, 403)
  await assert.rejects(h.directAdd(2), /not a member/)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
})

test('MCP: team-bound caller cannot grant outside its team', async () => {
  const h = harness({ teamScope: { teamId: 'a', accessBinding: 'owner:binding' } })
  assert.equal((await h.update()).status, 403)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
})

test('MCP create entry: mixed-team creation records first requested team and explicit accepted grants', async () => {
  const h = harness()
  const response = await h.create([2, 1])
  assert.equal(response.status, 201)
  assert.equal(h.state.agents[1].crossTeamHomeTeamId, 'b')
  assert.deepEqual(h.state.members.filter((row) => row.agentId === 'created-agent').map((row) => [row.projectId, row.status]), [[2, 'Accepted'], [1, 'Accepted']])
})

for (const [name, options, projectIds, scope, expected] of [
  ['foreign team', {}, [1, 3], undefined, 403],
  ['flag off mixed teams', { enabled: false }, [1, 2], undefined, 400],
  ['bound credential', {}, [1, 2], { teamId: 'a', accessBinding: 'owner:binding' }, 403],
  ['flag off same team', { enabled: false }, [1, 4], undefined, 201],
  ['bound credential same team', {}, [1, 4], { teamId: 'a', accessBinding: 'owner:binding' }, 201],
]) {
  test(`MCP create: ${name}`, async () => {
    const h = harness(options)
    const response = await h.createScoped(projectIds, scope)
    assert.equal(response.status, expected)
    assert.equal(h.state.agents.length, expected === 201 ? 2 : 1)
    if (expected !== 201) assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
  })
}

test('MCP create: serialization retry rechecks owner team authorization before writing', async () => {
  const h = harness({ conflicts: 1, beforeTransaction: (state) => {
    if (state.attempts === 2) state.teams[1].members = []
  } })
  assert.equal((await h.create()).status, 403)
  assert.equal(h.state.attempts, 2)
  assert.equal(h.state.agents.length, 1)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
})


test('MCP: unattached agent receiving mixed-team grants records first explicit team', async () => {
  const h = harness({ members: [] })
  assert.equal((await h.update([2, 1])).status, 200)
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'b')
  assert.deepEqual(h.state.members.map((row) => row.projectId), [2, 1])
})

for (const entry of ['cookie', 'update']) {
  test(`${entry}: original first membership, not destination, determines durable home`, async () => {
    const h = harness({ members: [2] })
    const response = await h[entry](entry === 'cookie' ? 1 : [1])
    assert.equal(response.statusCode ?? response.status, 200)
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'b')
  })

  test(`${entry}: bound agent still receives explicit grants within its credential team`, async () => {
    const h = harness({ credentialTeamId: 'a', credentialTeamAccessBinding: 'owner:binding' })
    const response = await h[entry](entry === 'cookie' ? 4 : [4])
    assert.equal(response.statusCode ?? response.status, 200)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1, 4])
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
  })
}

test('delegated admissions still allow explicitly scoped grants without expanding acting-agent scope', async () => {
  const h = harness({ actingAgentId: 'delegate' })
  h.state.agents.push({ ...h.state.agents[0], id: 'delegate' })
  h.state.members.push({ id: 50, projectId: 2, agentId: 'delegate', userId: 42, status: 'Accepted' })
  assert.equal((await h.update()).status, 200)
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
  assert.deepEqual(h.state.members.filter((row) => row.agentId === 'delegate').map((row) => row.projectId), [2])
})

test('MCP create: agents cannot create more agents', async () => {
  const h = harness({ actingAgentId: 'delegate' })
  assert.equal((await h.create()).status, 403)
  assert.equal(h.state.attempts, 0)
})

test('MCP create: exhausted conflicts leave neither identity nor explicit grants', async () => {
  const h = harness({ conflicts: 3 })
  await assert.rejects(h.create(), (error) => error.code === 'P2034')
  assert.equal(h.state.attempts, 3)
  assert.equal(h.state.agents.length, 1)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
})


test('MCP removals: removing all grants retains home across flag rollback', async () => {
  const h = harness()
  assert.equal((await h.update()).status, 200)
  assert.equal((await h.update([], [1, 2])).status, 200)
  assert.deepEqual(h.state.members, [])
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
  h.state.enabled = false
  assert.equal((await h.update([2])).status, 400)
  assert.equal((await h.update([4])).status, 200)
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
})

for (const entry of ['cookie', 'update']) {
  test(`${entry}: retries recheck ownership before new grants`, async () => {
    const h = harness({ conflicts: 1, beforeTransaction: (state) => {
      if (state.attempts === 2) state.agents[0].userId = 99
    } })
    const response = await h[entry]()
    assert.ok((response.statusCode ?? response.status) >= 400)
    assert.equal(h.state.attempts, 2)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
  })

  test(`${entry}: flag-off same-team grant remains allowed without marking identity`, async () => {
    const h = harness({ enabled: false })
    const response = await h[entry](entry === 'cookie' ? 4 : [4])
    assert.equal(response.statusCode ?? response.status, 200)
    assert.deepEqual(h.state.members.map((row) => row.projectId), [1, 4])
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
  })
}

test('MCP create: membership failure rolls back newly marked identity and token fields', async () => {
  const h = harness({ failMemberWrite: true })
  await assert.rejects(h.create(), /grant failed/)
  assert.equal(h.state.agents.length, 1)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1])
})


for (const entry of ['cookie', 'update']) {
  test(`${entry}: removing last legacy grant preserves lifetime home before later expansion`, async () => {
    const h = harness({ enabled: false })
    if (entry === 'cookie') assert.equal((await h.remove(1)).ok, true)
    else assert.equal((await h.update([], [1])).status, 200)
    assert.deepEqual(h.state.members, [])
    assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
    h.state.enabled = true
    const expanded = await h[entry]()
    assert.equal(expanded.statusCode ?? expanded.status, 200)
    assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
    h.state.enabled = false
    const denied = await h[entry](entry === 'cookie' ? 5 : [5])
    assert.ok((denied.statusCode ?? denied.status) >= 400)
    const allowed = await h[entry](entry === 'cookie' ? 4 : [4])
    assert.equal(allowed.statusCode ?? allowed.status, 200)
    assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
  })

  test(`${entry}: first admission sets lifetime home without marking same-team identity`, async () => {
    const h = harness({ members: [], enabled: false })
    const response = await h[entry](entry === 'cookie' ? 1 : [1])
    assert.equal(response.statusCode ?? response.status, 200)
    assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
    assert.equal(h.state.agents[0].crossTeamHomeTeamId, null)
  })
}

test('MCP create stores first explicit team as lifetime home without changing same-team privacy', async () => {
  const h = harness({ enabled: false })
  assert.equal((await h.create([1, 4])).status, 201)
  assert.equal(h.state.agents[1].boardHomeTeamId, 'a')
  assert.equal(h.state.agents[1].crossTeamHomeTeamId, null)
})

test('legacy replacement never reassigns lifetime home across later admissions', async () => {
  const h = harness({ enabled: false, boardHome: 'a' })
  assert.equal((await h.update([2], [1])).status, 200)
  assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
  assert.equal(h.state.agents[0].crossTeamAccessGranted, false)
  assert.deepEqual(h.state.members.map((row) => row.projectId), [2])
  h.state.enabled = true
  assert.equal((await h.update([5])).status, 200)
  assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
  assert.equal(h.state.agents[0].crossTeamAccessGranted, true)
  assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
})

for (const fallback of [false, true]) {
  test(`default team agent creation captures lifetime home (fallback=${fallback})`, async () => {
    const created = []
    let reads = 0
    const database = {
      agent: {
        findFirst: async () => null,
        create: async ({ data }) => { created.push(data); return { id: 'seed-agent' } },
      },
      project: { findFirst: async () => (++reads === 1 && fallback) ? null : { id: 15 } },
      team: { findFirst: async () => ({ id: 'a' }) },
      member: { create: async () => ({ id: 10 }) },
      $queryRaw: async () => [],
      $transaction: async (run) => run(database),
    }
    const { ensureDefaultTeamAgent } = load('src/utils/controllers/agents/ensureDefaultTeamAgent.ts', {
      '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    })
    assert.deepEqual(await ensureDefaultTeamAgent(42, 'a', database), { id: 'seed-agent', created: true })
    assert.equal(created.length, 1)
    assert.equal(created[0].boardHomeTeamId, 'a')
    assert.equal(created[0].crossTeamHomeTeamId, undefined)
  })
}

test('guest associated agent creation captures known lifetime team without expanding privacy', async () => {
  const created = []
  const create = async ({ data }) => ({ id: 'record', ...data })
  const database = {
    user: { create: async () => ({ id: 42 }), update: create, findUniqueOrThrow: async () => ({ id: 42 }) },
    team: { create: async () => ({ id: 'guest-team' }) },
    agent: { create: async ({ data }) => { created.push(data); return { id: 'guest-agent', ...data } } },
    project_View: { findUniqueOrThrow: async () => ({ id: 'view', default_view: { id: 'default' } }), update: create },
    user_Project_View: { upsert: async () => ({}) },
    team_Activity: { create, update: create },
    notification: { createMany: async () => ({ count: 0 }) },
  }
  for (const model of ['userSetting', 'userPicture', 'user_Activity', 'googleAccount', 'member_Team', 'member', 'section']) {
    database[model] = { create }
  }
  database.$transaction = async (operation) => typeof operation === 'function' ? operation(database) : Promise.all(operation)
  const { provisionGuest } = load('src/lib/demo/provisionGuest.ts', {
    '@/lib/prisma': { default: database },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
    '@/utils/helperFunctions/helperFunctions': { getSequentialLetters: () => 'DEMO' },
    '@/utils/controllers/projects/create': { createProjectViewAndCreateDefault: async () => {} },
    '@/utils/controllers/projects/createProjectWithStableName': { createProvisionedProjectWithStableName: async () => ({ id: 15 }) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/utils/controllers/tasks/createTaskCore': {},
    './generateDemoBoard': {},
    './guestSeedTasks': { GUEST_SEED_TASKS: [], GUEST_SEED_TASKS_IN_PROGRESS: [], getGuestSeedTasksInProgress: () => [] },
    './guest': { GUEST_UID_PREFIX: 'guest-' },
  })
  assert.equal((await provisionGuest('')).userId, 42)
  assert.equal(created.length, 1)
  assert.equal(created[0].boardHomeTeamId, 'guest-team')
  assert.equal(created[0].crossTeamHomeTeamId, undefined)
})


for (const entry of ['cookie', 'update']) {
  for (const expanded of [false, true]) {
    test(`${entry}: rollout-off rehoming preserves legacy moves and restricts expanded identities (expanded=${expanded})`, async () => {
      const h = harness({ enabled: false, boardHome: 'a', home: expanded ? 'a' : null })
      const removed = entry === 'cookie' ? await h.remove(1) : await h.update([], [1])
      assert.equal(entry === 'cookie' ? removed.ok : removed.status, entry === 'cookie' ? true : 200)
      const added = await h[entry](entry === 'cookie' ? 2 : [2])
      assert.equal(added.statusCode ?? added.status, expanded ? (entry === 'cookie' ? 403 : 400) : 200)
      assert.deepEqual(h.state.members.map((row) => row.projectId), expanded ? [] : [2])
      assert.equal(h.state.agents[0].boardHomeTeamId, 'a')
      assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
      assert.equal(h.state.agents[0].crossTeamAccessGranted, expanded)
      const { crossTeamProjectFence } = load('src/lib/agents/crossTeam.ts', {
        '@/lib/prisma': { default: { agent: { findFirst: async () => h.state.agents[0] } } },
        '@/lib/flags': { isFeatureEnabled: async () => false },
      })
      const fence = await crossTeamProjectFence('agent', 42)
      assert.ok(fence)
      assert.equal(fence.teamId ?? null, expanded ? 'a' : null)
      if (!expanded) {
        const anotherTeam = await h[entry](entry === 'cookie' ? 4 : [4])
        assert.equal(anotherTeam.statusCode ?? anotherTeam.status, entry === 'cookie' ? 403 : 400)
        assert.deepEqual(h.state.members.map((row) => row.projectId), [2])
        h.state.enabled = true
        const expandedGrant = await h[entry](entry === 'cookie' ? 5 : [5])
        assert.equal(expandedGrant.statusCode ?? expandedGrant.status, 200)
        assert.equal(h.state.agents[0].crossTeamHomeTeamId, 'a')
        assert.equal(h.state.agents[0].crossTeamAccessGranted, true)
        h.state.enabled = false
        assert.equal((await h.remove(5)).ok, true)
        const laterTeam = await h[entry](entry === 'cookie' ? 5 : [5])
        assert.equal(laterTeam.statusCode ?? laterTeam.status, entry === 'cookie' ? 403 : 400)
      }
    })
  }
}
