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
const routeSource = fs.readFileSync(
  path.join(root, 'src/app/api/mcp/tasks/next/route.ts'),
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
  relatedFromTasks = [],
  relatedToTasks = [],
}) {
  return {
    id,
    ticketNumber: `HTPR-${id}`,
    title: `Task ${id}`,
    section,
    projectId,
    status,
    priority: null,
    dueDate: null,
    createdAt: new Date(`2026-08-07T00:00:${String(id).padStart(2, '0')}.000Z`),
    taskLabels: [],
    relatedFromTasks,
    relatedToTasks,
  }
}

function loadRoute({ tasks, sectionsByProject }) {
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
        validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null }),
      }
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
