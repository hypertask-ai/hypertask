import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import path from 'node:path'
import { createJiti } from 'jiti'
import { NextRequest } from 'next/server'
import type { McpAuthContext } from '../src/lib/mcp/auth/types'
import type { AgentRole } from '../src/lib/mcp/agents/scopes'

const { matches } = require('./helpers/agent-board-scope.cjs')
const root = path.resolve(__dirname, '..')
const jiti = createJiti(__filename, {
  alias: { '@': path.join(root, 'src') },
  interopDefault: true,
  fsCache: false,
})
const user = { id: 42, email: 'owner@example.invalid', displayName: 'Owner' }
const ctx: McpAuthContext = { user, agentId: 'writer', teamScope: null }
let role: AgentRole | undefined = 'write'
let memberTeamIds: Array<string | null> = ['team']
let memberStatus = 'Accepted'
let membership = true
let ownsTeam = false
let agentOwnerId = user.id
let scopeLookups = 0
let flagOn = true
const creations: any[] = []
const prisma = {
  agent: {
    findUnique: async () => ({ permissions: role ? { role } : {} }),
    findFirst: async ({ where }: any) => {
      scopeLookups++
      const agent = {
        id: ctx.agentId,
        userId: agentOwnerId,
        members: memberTeamIds.map(teamId => ({ status: memberStatus, project: { teamId } })),
      }
      return matches(agent, where) ? { id: agent.id } : null
    },
  },
  user: { findUnique: async () => ({ ...user, accountId: ownsTeam ? 'account' : 'other-account' }) },
  team: { findUnique: async () => ({ id: 'team', googleAccountId: 'account' }) },
  member_Team: { findFirst: async () => membership ? { id: 1 } : null },
}
const stubs = {
  'src/lib/prisma.ts': { default: prisma },
  'src/lib/flags.ts': { isFeatureEnabled: async (key: string) => key === 'htpr-7509-write-agents-create-boards' && flagOn },
  'src/lib/flags/keys.ts': { HTPR_7509_WRITE_AGENTS_CREATE_BOARDS_FLAG: 'htpr-7509-write-agents-create-boards' },
  'src/lib/auth/agentScope.ts': { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
  'src/utils/controllers/projects/getAllIncludes.ts': { projectContentAccessWhere: () => ({}) },
  'src/lib/mcp/operationCrashReport.ts': { reportMcpOperationCrash: () => assert.fail('route must not crash') },
  'src/lib/mcp/operationContext.ts': { getMcpOperationContext: () => null },
  'src/lib/mcp/routeWrapper.ts': {
    wrapMcpRoute: (handler: any) => handler,
    validateMcpRouteAuth: async () => ctx,
    checkMcpRouteRateLimit: async () => null,
  },
  'src/lib/mcp/boards/createBoardFromManifest.ts': { createBoardFromManifest: () => assert.fail('use injected creator') },
  'src/lib/mcp/idempotency/idempotencyStore.ts': {
    IdempotencyAccessError: class extends Error {},
    IdempotencyInProgressError: class extends Error {},
    normalizeIdempotencyKey: () => null,
    withIdempotency: async (_operation: string, _userId: number, _key: null, _input: unknown, run: () => Promise<unknown>) => run(),
  },
  'src/utils/controllers/projects/boardQuota.ts': { BoardLimitReachedError: class extends Error {} },
}
const originals = new Map<string, NodeJS.Module | undefined>()
for (const [file, exports] of Object.entries(stubs)) {
  const filename = path.join(root, file)
  originals.set(filename, require.cache[filename])
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module
}
after(() => {
  for (const [filename, original] of originals) {
    if (original) require.cache[filename] = original
    else delete require.cache[filename]
  }
})
const { POST } = jiti(path.join(root, 'src/lib/mcp/operations/teams/[teamId]/boards/operation.ts')) as any
const { checkAgentBoardDelegation } = jiti(path.join(root, 'src/lib/mcp/agents/delegatedAccess.ts')) as any

function reset() {
  ctx.agentId = 'writer'
  role = 'write'
  memberTeamIds = ['team']
  memberStatus = 'Accepted'
  membership = true
  ownsTeam = false
  agentOwnerId = user.id
  scopeLookups = 0
  flagOn = true
  creations.length = 0
}

async function createBoard() {
  const request = new NextRequest('http://localhost/api/mcp/teams/team/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Created', sections: [{ title: 'Todo' }] }),
  })
  return POST(request, { params: Promise.resolve({ teamId: 'team' }) }, {
    createBoardFromManifest: async (input: unknown) => {
      creations.push(input)
      return { board: { id: 900 }, sections: [], labels: [], tasks: [] }
    },
  })
}

for (const actor of ['write', 'default-write', 'admin', 'person', 'team-owner'] as const) {
  test(`${actor} can create a board with existing owner access`, async () => {
    reset()
    if (actor === 'default-write') role = undefined
    if (actor === 'admin') { role = 'admin'; memberTeamIds = [] }
    if (actor === 'person') { ctx.agentId = null; memberTeamIds = [] }
    if (actor === 'team-owner') { membership = false; ownsTeam = true }
    const response = await createBoard()
    assert.equal(response.status, 200)
    assert.equal((await response.json()).success, true)
    assert.equal(creations.length, 1)
    assert.equal(creations[0].teamId, 'team')
    assert.equal(creations[0].userId, user.id)
    assert.equal(creations[0].creation.agentId, ctx.agentId)
    assert.equal(scopeLookups, actor === 'admin' || actor === 'person' ? 0 : 1)
  })
}

test('flag off keeps today: write agent is refused, admin agent still creates', async () => {
  reset()
  flagOn = false
  const refused = await createBoard()
  assert.equal(refused.status, 403)
  assert.match((await refused.json()).error, /requires 'admin' or higher/)
  assert.deepEqual(creations, [])
  role = 'admin'
  const allowed = await createBoard()
  assert.equal(allowed.status, 200)
  assert.equal(creations.length, 1)
})

test('read agent is refused with insufficient_scope before board creation', async () => {
  reset()
  role = 'read'
  const response = await createBoard()
  assert.equal(response.status, 403)
  assert.equal((await response.json()).code, 'insufficient_scope')
  assert.deepEqual(creations, [])
  assert.equal(scopeLookups, 0)
})

for (const teamIds of [[], ['other-team'], [null]]) {
  test(`write agent with board teams ${JSON.stringify(teamIds)} cannot create in this team`, async () => {
    reset()
    memberTeamIds = teamIds
    const response = await createBoard()
    assert.equal(response.status, 403)
    assert.deepEqual(creations, [])
    assert.equal(scopeLookups, 1)
  })
}

for (const teamIds of [['team', 'other-team'], ['team', null]]) {
  test(`write agent on boards ${JSON.stringify(teamIds)} can still create in a team it belongs to`, async () => {
    reset()
    memberTeamIds = teamIds
    const response = await createBoard()
    assert.equal(response.status, 200)
    assert.equal(creations.length, 1)
  })
}

test('write agent with only an Invited board membership in the team is refused', async () => {
  reset()
  memberStatus = 'Invited'
  const response = await createBoard()
  assert.equal(response.status, 403)
  assert.deepEqual(creations, [])
})

test('write agent cannot bypass the owner user team access check', async () => {
  reset()
  membership = false
  const response = await createBoard()
  assert.equal(response.status, 403)
  assert.equal((await response.json()).message, 'User cannot create boards on this team')
  assert.deepEqual(creations, [])
})

test('agent team membership cannot substitute for matching agent ownership', async () => {
  reset()
  agentOwnerId++
  const response = await createBoard()
  assert.equal(response.status, 403)
  assert.deepEqual(creations, [])
})

test('admin agent retains cross-team board creation with owner access', async () => {
  reset()
  role = 'admin'
  memberTeamIds = ['other-team']
  const response = await createBoard()
  assert.equal(response.status, 200)
  assert.equal(creations.length, 1)
  assert.equal(scopeLookups, 0)
})

test('write agent still cannot delegate board access, while admin can', async () => {
  reset()
  const response = await checkAgentBoardDelegation(ctx, 'other-agent')
  assert.equal(response.status, 403)
  const body = await response.json()
  assert.equal(body.code, 'insufficient_scope')
  assert.match(body.error, /requires 'admin' or higher/)
  assert.deepEqual(creations, [])
  role = 'admin'
  assert.equal(await checkAgentBoardDelegation(ctx, 'other-agent'), null)
})
