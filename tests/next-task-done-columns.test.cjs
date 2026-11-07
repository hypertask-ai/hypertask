const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(
  path.join(root, 'tests/next-task-done-columns.test.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
  }
)
const { doneColumnTitles } = jiti(path.join(root, 'src/lib/doneColumns.ts'))
const { blockerStillOpen } = jiti(
  path.join(root, 'src/lib/mcp/tasks/blockerStillOpen.ts')
)
const { columnRole } = jiti(
  path.join(root, 'src/lib/mcp/boards/columnRole.ts')
)
const { HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG } = jiti(
  path.join(root, 'src/lib/flags/definitions/htpr-8786-picker-skips-other-agents.ts')
)
const listParams = jiti(path.join(root, 'src/lib/mcp/listParams.ts'))
const routeSource = fs.readFileSync(
  path.join(root, 'src/lib/mcp/operations/tasks/next/operation.ts'),
  'utf8'
)
const routeJavascript = ts.transpileModule(routeSource, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText

function task({
  id,
  section,
  projectId = 15,
  status = 'Normal',
  assignees = [],
  relatedFromTasks = [],
  relatedToTasks = [],
  waitingOnUserId = null,
  blockerCommentId = null,
}) {
  return {
    id,
    ticketNumber: `HTPR-${id}`,
    title: `Task ${id}`,
    section,
    projectId,
    status,
    assignees,
    waitingOnUserId,
    blockerCommentId,
    priority: null,
    dueDate: null,
    createdAt: new Date(`2026-08-07T00:00:${String(id).padStart(2, '0')}.000Z`),
    taskLabels: [],
    relatedFromTasks,
    relatedToTasks,
  }
}

function assigneeClauseMatches(row, clause) {
  if (clause.NOT && Object.prototype.hasOwnProperty.call(clause.NOT, 'agentId')) {
    return row.agentId !== clause.NOT.agentId
  }
  if (clause.agentId && Object.prototype.hasOwnProperty.call(clause.agentId, 'not')) {
    return clause.agentId.not === null
      ? row.agentId != null
      : row.agentId !== clause.agentId.not
  }
  return false
}

function passesAssigneeFilter(candidate, where) {
  const none = where.assignees && where.assignees.none
  if (!none) return true
  const clauses = Array.isArray(none.AND) ? none.AND : [none]
  const ownedByAnotherAgent = (candidate.assignees || []).some((row) =>
    clauses.every((clause) => assigneeClauseMatches(row, clause))
  )
  return !ownedByAnotherAgent
}

function loadRoute({ tasks, sectionsByProject, agentId = null, skipOtherAgents = false, skipParked = false }) {
  const doneTitleLoads = []
  const taskQueries = []
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15 }),
    },
    task: {
      findMany: async (query) => {
        taskQueries.push(query)
        const sectionFilter = query.where.section
        const matchingTasks = tasks.filter((candidate) => {
          if (candidate.status !== query.where.status) return false
          if (!passesAssigneeFilter(candidate, query.where)) return false
          if (typeof sectionFilter === 'string') {
            return candidate.section === sectionFilter
          }
          if (sectionFilter?.notIn) {
            const excluded = new Set(
              sectionFilter.notIn.map((title) =>
                sectionFilter.mode === 'insensitive' ? title.toLowerCase() : title
              )
            )
            const candidateSection =
              sectionFilter.mode === 'insensitive'
                ? candidate.section.toLowerCase()
                : candidate.section
            return !excluded.has(candidateSection)
          }
          return true
        })
        return matchingTasks.slice(0, query.take)
      },
    },
  }
  const loadDoneTitlesByProject = async (projectIds, nameFallback) => {
    const uniqueProjectIds = Array.from(new Set(projectIds))
    doneTitleLoads.push(uniqueProjectIds)
    return new Map(
      uniqueProjectIds.map((projectId) => [
        projectId,
        doneColumnTitles(sectionsByProject.get(projectId) ?? [], nameFallback),
      ])
    )
  }
  const routeModule = { exports: {} }
  const mockRequire = (request) => {
    if (request === '@/lib/mcp/operationCrashReport') return { reportMcpOperationCrash: () => {} }
    if (request === '@/lib/mcp/routeWrapper') return require('./helpers/mcp-route-wrapper.cjs').loadRouteWrapper({ '@/lib/mcp/auth': mockRequire('@/lib/mcp/auth') })
    if (request === 'next/server') {
      return {
        NextResponse: {
          json: (body, init = {}) => ({ body, status: init.status ?? 200 }),
        },
      }
    }
    if (request === '@/lib/mcp/auth') {
      return {
        checkMcpRateLimit: async () => null,
        validateMcpAuth: async () => ({ user: { id: 6 }, agentId }),
      }
    }
    if (request === '@/lib/flags') {
      return {
        isFeatureEnabled: async (key) =>
          (skipOtherAgents && key === HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG) ||
          (skipParked && key === 'htpr-8738-picker-skips-parked'),
      }
    }
    if (request === '@/lib/flags/definitions/htpr-8786-picker-skips-other-agents') {
      return { HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG }
    }
    if (request === '@/lib/flags/definitions/htpr-8738-picker-skips-parked') {
      return { HTPR_8738_PICKER_SKIPS_PARKED_FLAG: 'htpr-8738-picker-skips-parked' }
    }
    if (request === '@/lib/mcp/tasks/otherAgentAssignee') {
      return jiti(path.join(root, 'src/lib/mcp/tasks/otherAgentAssignee.ts'))
    }
    if (request === '@/lib/prisma') {
      return { __esModule: true, default: prisma }
    }
    if (request === '@/lib/mcp/tasks/priorityScore') {
      return { priorityScore: () => 0 }
    }
    if (request === '@/lib/mcp/tasks/blockerStillOpen') {
      return { blockerStillOpen }
    }
    if (request === '@/lib/mcp/boards/columnRole') {
      return { columnRole }
    }
    if (request === '@/utils/controllers/projects/getAllIncludes') {
      return { getProjectWhere: () => ({}) }
    }
    if (request === '@/utils/controllers/notifications/inboxZero') {
      return { loadDoneTitlesByProject }
    }
    if (request === '@/lib/mcp/listParams') {
      return listParams
    }
    throw new Error(`Unexpected import: ${request}`)
  }

  new Function('module', 'exports', 'require', routeJavascript)(
    routeModule,
    routeModule.exports,
    mockRequire
  )

  return { GET: routeModule.exports.GET, doneTitleLoads, taskQueries }
}

async function callNext(GET, query = {}) {
  const searchParams = new URLSearchParams({ project_id: '15', ...query })
  return GET({ nextUrl: { searchParams } })
}

test('the default call excludes resolved done tasks and keeps ordinary tasks', async () => {
  const route = loadRoute({
    tasks: [
      task({ id: 1, section: 'Done' }),
      task({ id: 2, section: 'In Progress' }),
    ],
    sectionsByProject: new Map([
      [
        15,
        [
          { section_title: 'Done', isDone: true },
          { section_title: 'In Progress', isDone: false },
        ],
      ],
    ]),
  })

  const response = await callNext(route.GET)

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [2]
  )
  assert.deepEqual(route.doneTitleLoads, [[15]])
  assert.deepEqual(route.taskQueries[0].where.section.notIn, ['done'])
})

test('an explicit done section still returns its tasks', async () => {
  const route = loadRoute({
    tasks: [
      task({ id: 1, section: 'Done' }),
      task({ id: 2, section: 'In Progress' }),
    ],
    sectionsByProject: new Map([
      [15, [{ section_title: 'Done', isDone: true }]],
    ]),
  })

  const response = await callNext(route.GET, { section: 'Done' })

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [1]
  )
  assert.equal(route.taskQueries[0].where.section, 'Done')
})

test('a custom resolved finished column is excluded without a hardcoded title', async () => {
  const route = loadRoute({
    tasks: [
      task({ id: 1, section: 'Quality Assured' }),
      task({ id: 2, section: 'Ready' }),
    ],
    sectionsByProject: new Map([
      [
        15,
        [
          { section_title: 'Quality Assured', isDone: true },
          { section_title: 'Ready', isDone: false },
        ],
      ],
    ]),
  })

  const response = await callNext(route.GET)

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [2]
  )
  assert.deepEqual(route.taskQueries[0].where.section, {
    notIn: ['quality assured'],
    mode: 'insensitive',
  })
})

test('exclude_blocked still drops open blockers and accepts finished blockers', async () => {
  const route = loadRoute({
    tasks: [
      task({
        id: 1,
        section: 'Ready',
        relatedFromTasks: [
          {
            targetTask: {
              status: 'Normal',
              section: 'In Progress',
              projectId: 22,
            },
          },
        ],
      }),
      task({
        id: 2,
        section: 'Ready',
        relatedToTasks: [
          {
            sourceTask: {
              status: 'Normal',
              section: 'Released to Customers',
              projectId: 23,
            },
          },
        ],
      }),
    ],
    sectionsByProject: new Map([
      [15, [{ section_title: 'Shipped', isDone: true }]],
      [22, [{ section_title: 'In Progress', isDone: false }]],
      [23, [{ section_title: 'Released to Customers', isDone: true }]],
    ]),
  })

  const response = await callNext(route.GET, { exclude_blocked: 'true' })

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [2]
  )
  assert.deepEqual(route.doneTitleLoads, [[15], [22, 23]])
})

const callerAgentId = '11111111-1111-4111-8111-111111111111'
const otherAgentId = '22222222-2222-4222-8222-222222222222'

function assignedWork() {
  return [
    task({
      id: 1,
      section: 'Doing',
      assignees: [{ agentId: otherAgentId, userId: 9 }],
    }),
    task({ id: 2, section: 'Doing' }),
    task({
      id: 3,
      section: 'Doing',
      assignees: [{ agentId: callerAgentId, userId: 6 }],
    }),
    task({
      id: 4,
      section: 'In Progress',
      assignees: [{ agentId: null, userId: 8 }],
    }),
    task({
      id: 5,
      section: 'Doing',
      assignees: [
        { agentId: callerAgentId, userId: 6 },
        { agentId: otherAgentId, userId: 9 },
      ],
    }),
    task({
      id: 6,
      section: 'Ready',
      assignees: [{ agentId: otherAgentId, userId: 9 }],
    }),
  ]
}

const workSections = new Map([
  [
    15,
    [
      { section_title: 'Doing', isDone: false },
      { section_title: 'In Progress', isDone: false },
      { section_title: 'Ready', isDone: false },
    ],
  ],
])

test('an agent next call skips Doing and In Progress tickets assigned to another agent', async () => {
  const route = loadRoute({
    tasks: assignedWork(),
    sectionsByProject: workSections,
    agentId: callerAgentId,
    skipOtherAgents: true,
  })

  const response = await callNext(route.GET)

  assert.deepEqual(
    response.body.tasks.map(({ id, section }) => ({ id, section })),
    [
      { id: 2, section: 'Doing' },
      { id: 3, section: 'Doing' },
      { id: 4, section: 'In Progress' },
    ]
  )
  assert.equal(response.status, 200)
})

test('the same Doing ticket assigned to another agent is returned while the pick filter is off', async () => {
  const route = loadRoute({
    tasks: assignedWork(),
    sectionsByProject: workSections,
    agentId: callerAgentId,
    skipOtherAgents: false,
  })

  const response = await callNext(route.GET)

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [1, 2, 3, 4, 5, 6]
  )
})

test('the default pick leaves out review columns and tickets waiting on a person', async () => {
  const route = loadRoute({
    tasks: [
      task({ id: 1, section: 'In Progress' }),
      task({ id: 2, section: 'Valentin Review' }),
      task({ id: 3, section: 'AI Review' }),
      task({ id: 4, section: 'UX Sign-off' }),
      task({ id: 5, section: 'Flags' }),
      task({ id: 6, section: 'In Progress', waitingOnUserId: 6 }),
      task({ id: 7, section: 'Doing', blockerCommentId: 44 }),
      task({ id: 8, section: 'Ready' }),
    ],
    sectionsByProject: new Map([
      [15, [
        { section_title: 'In Progress', isDone: false },
        { section_title: 'Ready', isDone: false },
      ]],
    ]),
    skipParked: true,
  })

  const response = await callNext(route.GET)

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [1, 8]
  )
})

test('an explicit section still returns a ticket waiting on a person', async () => {
  const route = loadRoute({
    tasks: [
      task({ id: 6, section: 'In Progress', waitingOnUserId: 6 }),
    ],
    sectionsByProject: new Map([
      [15, [{ section_title: 'In Progress', isDone: false }]],
    ]),
    skipParked: true,
  })

  const response = await callNext(route.GET, { section: 'In Progress' })

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [6]
  )
})

test('a person calling next still sees a Doing ticket assigned to an agent', async () => {
  const route = loadRoute({
    tasks: assignedWork(),
    sectionsByProject: workSections,
    agentId: null,
    skipOtherAgents: true,
  })

  const response = await callNext(route.GET)

  assert.deepEqual(
    response.body.tasks.map(({ id }) => id),
    [1, 2, 3, 4, 5, 6]
  )
})
