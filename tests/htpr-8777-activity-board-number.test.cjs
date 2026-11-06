const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const flag = 'htpr-8777-activity-board-number'
const report = {
  id: 88976,
  projectId: 15,
  uniqueIndex: 8777,
  ticketNumber: 'HTPR-8777',
  status: 'Normal',
  accessible: true,
}
const hiddenId = {
  id: 8777,
  projectId: 99,
  uniqueIndex: 100,
  ticketNumber: 'ZZ-100',
  status: 'Normal',
  accessible: false,
}

function matches(task, where) {
  if (!where) return true
  if (where.OR) return where.OR.some((part) => matches(task, { ...where, OR: undefined, ...part }))
  if (where.id != null && task.id !== where.id) return false
  if (where.projectId != null && task.projectId !== where.projectId) return false
  if (where.uniqueIndex != null && task.uniqueIndex !== where.uniqueIndex) return false
  if (where.ticketNumber?.equals && task.ticketNumber.toLowerCase() !== String(where.ticketNumber.equals).toLowerCase()) return false
  if (where.status?.not && task.status === where.status.not) return false
  if (where.project && task.accessible === false) return false
  return true
}

function fixture({ enabled = true, flagError = false, rows = [report, hiddenId] } = {}) {
  const opened = []
  const flagReads = []
  const db = {
    task: {
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where, take }) => rows.filter((row) => matches(row, where)).slice(0, take ?? rows.length),
    },
    taskNumberAlias: { findMany: async () => [] },
  }
  const principal = {
    userId: 6,
    agentId: 'runner-3',
    displayName: 'Runner 3',
    source: 'agent',
    teamScope: null,
  }
  const route = load('src/lib/mcp/operations/agents/[agentId]/operation.ts', {
    '@/lib/flags': {
      HTPR_6868_TICKET_PREFIX_FLAG: 'htpr-6868-ticket-prefix',
      isFeatureEnabled: async (key, userId) => {
        flagReads.push({ key, userId })
        if (flagError) throw new Error('flag store unavailable')
        return key === flag && enabled
      },
    },
    '@/lib/prisma': { default: db },
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss: () => {} },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectWhere: () => ({ accessible: true }),
      intersectProjectTeamScope: (access) => access,
    },
    '@/utils/controllers/projects/findPrefixAliasTasks': { findPrefixAliasTasks: async () => [] },
    '@/lib/agentRuns/service': {
      authenticateAgentRunRequest: async () => principal,
      runtimeAgentRunsEnabledFor: async () => true,
      createRuntimeAgentRun: async (_principal, input) => {
        opened.push(input)
        return input.taskId === report.id ? { id: 'run-1', taskId: report.id } : null
      },
    },
    '@/lib/mcp/auth': { checkMcpRateLimit: async () => null },
    '@/lib/mcp/agents/delete': { handleDeleteAgentRequest: async () => null },
    '@/lib/mcp/agents/get': { handleGetAgentRequest: async () => null },
    '@/lib/mcp/agents/lifecycleRequests': { handlePatchAgentRequest: async () => null },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (run) => run },
    '@/lib/mcp/tasks/agentMutationFence': { TaskTeamScopeError: class TaskTeamScopeError extends Error {} },
    'next/server': {
      NextResponse: {
        json: (body, init) => Response.json(body, init),
      },
    },
  })
  const post = (body) => route.POST(
    { json: async () => body },
    { params: Promise.resolve({ agentId: 'runs' }) },
  )
  return { post, opened, flagReads }
}

test('the board number from a feedback link opens activity on that ticket', async () => {
  const f = fixture()
  const response = await f.post({ taskId: 8777, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.run.taskId, report.id)
  assert.deepEqual(f.opened, [{ taskId: report.id, title: null, source: 'runtime' }])
  assert.deepEqual(f.flagReads, [{ key: flag, userId: 6 }])
})

test('the database id still opens that ticket, including with its project', async () => {
  const f = fixture()
  const response = await f.post({ taskId: report.id, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 201)
  assert.deepEqual(f.opened, [{ taskId: report.id, title: null, source: 'runtime' }])
})

test('a bare board number is not guessed onto another board', async () => {
  const f = fixture()
  const response = await f.post({ taskId: 8777, source: 'runtime' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'Task not found')
  assert.deepEqual(f.opened, [{ taskId: 8777, title: null, source: 'runtime' }])
  assert.deepEqual(f.flagReads, [])
})

test('a number that is both a task id and a different board number is refused', async () => {
  const f = fixture({
    rows: [
      report,
      { id: 8777, projectId: 15, uniqueIndex: 100, ticketNumber: 'HTPR-100', status: 'Normal', accessible: true },
    ],
  })
  const response = await f.post({ taskId: 8777, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /board number/)
  assert.deepEqual(f.opened, [])
})

test('flag off keeps the board number as a missing task id', async () => {
  const f = fixture({ enabled: false })
  const response = await f.post({ taskId: 8777, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'Task not found')
  assert.deepEqual(f.opened, [{ taskId: 8777, title: null, source: 'runtime' }])
})

test('a flag lookup failure keeps the old lookup', async () => {
  const f = fixture({ flagError: true })
  const response = await f.post({ taskId: 8777, projectId: 15, source: 'runtime' })
  assert.equal(response.status, 404)
  assert.deepEqual(f.opened, [{ taskId: 8777, title: null, source: 'runtime' }])
})

test('projectId is accepted and any other extra field is still refused', async () => {
  const f = fixture()
  const response = await f.post({ taskId: report.id, projectId: 15, source: 'runtime', note: 'no' })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'unknown field: note')
  assert.deepEqual(f.opened, [])
})
