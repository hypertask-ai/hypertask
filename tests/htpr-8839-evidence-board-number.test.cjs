const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { load } = require('./task-route-loader.cjs')

const flag = 'htpr-8839-evidence-board-number'
const report = {
  id: 89578,
  projectId: 15,
  uniqueIndex: 8839,
  ticketNumber: 'HTPR-8839',
  status: 'Normal',
  accessible: true,
}
const hiddenId = {
  id: 8839,
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
  if (where.task?.status?.not && task.status === where.task.status.not) return false
  if (where.task?.project && task.accessible === false) return false
  return true
}

function fixture({ enabled = true, flagError = false, rows = [report, hiddenId] } = {}) {
  const evidence = []
  const flagReads = []
  const db = {
    task: {
      findFirst: async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where, take }) => rows.filter((row) => matches(row, where)).slice(0, take ?? rows.length),
    },
    taskNumberAlias: { findMany: async () => [] },
    taskEvidence: {
      create: async ({ data }) => {
        const row = { id: evidence.length + 1, createdAt: new Date('2026-11-06T00:00:00.000Z'), ...data }
        evidence.push(row)
        return row
      },
      findMany: async ({ where }) => evidence.filter((row) => row.taskId === where.taskId),
    },
  }
  const ctx = { user: { id: 6, email: 'owner@example.invalid' }, agentId: 'runner-a', agentRole: 'write', teamScope: null }
  const route = load('src/app/api/mcp/tasks/evidence/route.ts', {
    '@/lib/flags': {
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
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (run) => run,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ctx,
    },
    'next/server': {
      NextResponse: {
        json: (body, init) => Response.json(body, init),
      },
    },
  })
  const post = (body) => route.POST({
    json: async () => body,
    nextUrl: new URL('http://mcp.test/api/mcp/tasks/evidence'),
  })
  const get = (query) => route.GET({
    nextUrl: new URL(`http://mcp.test/api/mcp/tasks/evidence${query}`),
  })
  return { post, get, evidence, flagReads }
}

test('flag definition is a bugfix, live for everyone', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/flags/definitions/htpr-8839-evidence-board-number.ts'), 'utf8')
  assert.match(source, /export const HTPR_8839_EVIDENCE_BOARD_NUMBER_FLAG = "htpr-8839-evidence-board-number"/)
  assert.match(source, /kind: "bugfix"/)
  assert.match(source, /defaultMode: "EVERYONE"/)
  assert.match(source, /risk: "small"/)
})

test('the board number from a feedback link attaches evidence to that report', async () => {
  const f = fixture()
  const response = await f.post({
    task_id: 8839,
    project_id: 15,
    type: 'Other',
    summary: 'seen again',
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.evidence.summary, 'seen again')
  assert.equal(f.evidence.length, 1)
  assert.equal(f.evidence[0].taskId, report.id)
  assert.deepEqual(f.flagReads, [{ key: flag, userId: 6 }])
})

test('unique_index plus project_id addresses the same report', async () => {
  const f = fixture()
  const response = await f.post({
    unique_index: 8839,
    project_id: 15,
    type: 'Link',
    url: 'https://app.hypertask.ai/detail/project-15/8839',
  })
  assert.equal(response.status, 201)
  assert.equal(f.evidence[0].taskId, report.id)
})

test('listing evidence accepts the same board number', async () => {
  const f = fixture()
  assert.equal((await f.post({ task_id: 8839, project_id: 15, summary: 'proof' })).status, 201)
  const listed = await f.get('?task_id=8839&project_id=15')
  assert.equal(listed.status, 200)
  const body = await listed.json()
  assert.equal(body.taskId, report.id)
  assert.equal(body.evidence.length, 1)
  assert.equal(body.evidence[0].summary, 'proof')
})

test('the database id still addresses that row, including with its project', async () => {
  const f = fixture()
  const response = await f.post({ task_id: report.id, project_id: 15, summary: 'by id' })
  assert.equal(response.status, 201)
  assert.equal(f.evidence[0].taskId, report.id)
})

test('a bare board number is not guessed onto another board', async () => {
  const f = fixture()
  const response = await f.post({ task_id: 8839, summary: 'no board' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'Task not found or access denied')
  assert.equal(f.evidence.length, 0)
})

test('a number that is both a task id and a different board number is refused', async () => {
  const f = fixture({
    rows: [
      report,
      { id: 8839, projectId: 15, uniqueIndex: 100, ticketNumber: 'HTPR-100', status: 'Normal', accessible: true },
    ],
  })
  const response = await f.post({ task_id: 8839, project_id: 15, summary: 'which one' })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /board number/)
  assert.equal(f.evidence.length, 0)
})

test('ticket number still finds the report', async () => {
  const f = fixture({ enabled: false })
  const response = await f.post({ ticket_number: 'htpr-8839', summary: 'by ticket' })
  assert.equal(response.status, 201)
  assert.equal(f.evidence[0].taskId, report.id)
})

test('flag off keeps the board number as a missing task id', async () => {
  const f = fixture({ enabled: false })
  const response = await f.post({ task_id: 8839, project_id: 15, summary: 'old lookup' })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error, 'Task not found or access denied')
  assert.equal(f.evidence.length, 0)
  const listed = await f.get('?unique_index=8839&project_id=15')
  assert.equal(listed.status, 400)
})

test('a flag lookup failure keeps the old lookup', async () => {
  const f = fixture({ flagError: true })
  const response = await f.post({ task_id: 8839, project_id: 15, summary: 'flags down' })
  assert.equal(response.status, 404)
  assert.equal(f.evidence.length, 0)
})
