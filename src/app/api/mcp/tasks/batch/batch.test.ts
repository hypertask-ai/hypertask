// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/tasks/batch/batch.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

function makeTask(id: number) {
  const timestamp = new Date('2026-07-25T12:00:00.000Z')
  return {
    id,
    ticketNumber: `HTPR-${id}`,
    uniqueIndex: id,
    title: `Task ${id}`,
    description: '',
    description_: null,
    descriptionJson: null,
    section: 'Todo',
    sectionId: 10,
    sectionChangedAt: timestamp,
    lastCommentAt: null,
    parentTaskId: null,
    parentTask: null,
    subTasks: [],
    projectId: 20,
    project: { id: 20, title: 'Test board' },
    status: 'Normal' as const,
    priority: null,
    estimate: null,
    dueDate: null,
    agent: null,
    assignees: [],
    followers: [],
    taskLabels: [],
    attachments: [],
    _count: { comments: 0 },
    user: {
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'batch-test-session-secret'

  const [{ default: prisma }, { handleBatchBody }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/tasks/batchTasks'),
  ])

  const prismaMock = prisma as any
  const originalTaskFindMany = prismaMock.task.findMany
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalAssigneesFindMany = prismaMock.assignees.findMany
  const originalFetch = globalThis.fetch
  const taskOne = makeTask(1)
  const request = new NextRequest(
    'http://localhost/api/mcp/tasks/batch',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    }
  )
  const ctx = {
    user: { id: 6, email: 'valentin@example.com' },
    agentId: null,
  }
  const expectedProjectScope = {
    teamId: { not: null },
    OR: [
      { ownerId: 6 },
      { members: { some: { userId: 6, agentId: null } } },
    ],
  }

  try {
    let getQueryCount = 0
    prismaMock.task.findMany = async (args: Record<string, any>) => {
      getQueryCount += 1
      assert.deepEqual(args.where.id.in, [1, 2, 3])
      assert.deepEqual(
        args.where.project,
        expectedProjectScope,
        'get query includes the caller project access scope'
      )
      assert.ok(args.include, 'get query uses the MCP GET include')
      return [taskOne]
    }

    const getResponse = await handleBatchBody(request, ctx, {
      op: 'get',
      // The scoped query deliberately resolves neither the missing task 2 nor
      // the inaccessible task 3; callers must receive the same result for both.
      task_ids: [1, 2, 3],
    })
    const getBody = await json(getResponse)
    assert.equal(getResponse.status, 200)
    assert.equal(getQueryCount, 1, 'batch get uses one task query')
    assert.equal(getBody.success, true)
    assert.deepEqual(
      getBody.tasks.map((task: { id: number }) => task.id),
      [1]
    )
    assert.equal(getBody.tasks[0].boardTitle, 'Test board')
    assert.deepEqual(getBody.notFound, [2, 3])

    prismaMock.task.findMany = async () => []
    const getBoundaryResponse = await handleBatchBody(request, ctx, {
      op: 'get',
      task_ids: Array.from({ length: 100 }, (_, index) => index + 1),
    })
    const getBoundaryBody = await json(getBoundaryResponse)
    assert.equal(getBoundaryResponse.status, 200)
    assert.equal(getBoundaryBody.notFound.length, 100)

    const getCapResponse = await handleBatchBody(request, ctx, {
      op: 'get',
      task_ids: Array.from({ length: 101 }, (_, index) => index + 1),
    })
    const getCapBody = await json(getCapResponse)
    assert.equal(getCapResponse.status, 400)
    assert.deepEqual(
      {
        success: getCapBody.success,
        code: getCapBody.code,
        field: getCapBody.field,
      },
      {
        success: false,
        code: 'invalid_field',
        field: 'task_ids',
      }
    )

    const updateCapResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: Array.from({ length: 101 }, () => ({
        task_id: 1,
        title: 'Updated',
      })),
    })
    const updateCapBody = await json(updateCapResponse)
    assert.equal(updateCapResponse.status, 400)
    assert.deepEqual(
      {
        success: updateCapBody.success,
        code: updateCapBody.code,
        field: updateCapBody.field,
      },
      {
        success: false,
        code: 'invalid_field',
        field: 'updates',
      }
    )

    const updateBoundaryResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: Array.from({ length: 100 }, () => null),
    })
    const updateBoundaryBody = await json(updateBoundaryResponse)
    assert.equal(updateBoundaryResponse.status, 200)
    assert.equal(updateBoundaryBody.results.length, 100)
    assert.ok(
      updateBoundaryBody.results.every(
        (result: { success: boolean }) => result.success === false
      )
    )

    prismaMock.user.findUnique = async () => ({
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
      photoURL: null,
    })
    prismaMock.assignees.findMany = async () => []
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = async (input, init) => {
      fetchCalls.push({
        url: typeof input === 'string' ? input : input.toString(),
        init,
      })
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        assert.deepEqual(
          args.where.project,
          expectedProjectScope,
          'each update lookup includes the caller project access scope'
        )
        const taskIds = args.where.OR[0]?.id?.in as number[]
        return taskIds.includes(1)
          ? [{ id: 1, sectionId: 10, projectId: 20 }]
          : []
      }
      if (args.where.id?.in) {
        return args.where.id.in.includes(1) ? [taskOne] : []
      }
      throw new Error('Unexpected task.findMany call')
    }

    const partialResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: [
        { task_id: 1, title: 'Updated title' },
        { task_id: 2, priority: 'impossible-priority' },
      ],
    })
    const partialBody = await json(partialResponse)
    assert.equal(partialResponse.status, 200)
    assert.equal(partialBody.success, true)
    assert.deepEqual(
      partialBody.results.map(
        (result: { task_id: number; success: boolean }) => ({
          task_id: result.task_id,
          success: result.success,
        })
      ),
      [
        { task_id: 1, success: true },
        { task_id: 2, success: false },
      ]
    )
    assert.equal(partialBody.results[0].task.id, 1)
    assert.equal(partialBody.results[1].code, 'invalid_field')
    assert.equal(partialBody.results[1].field, 'priority')
    assert.ok(
      Array.isArray(partialBody.results[1].allowed_values),
      'per-item errors preserve allowed_values from the shared updater'
    )
    assert.equal(
      partialBody.results[1].details.code,
      'invalid_range',
      'per-item errors preserve structured validation details'
    )
    const titleUpdateCall = fetchCalls.find((call) =>
      call.url.endsWith('/api/tasks/single')
    )
    assert.ok(titleUpdateCall, 'title updates call the legacy single-task API')
    assert.equal(titleUpdateCall.init?.method, 'PUT')
    assert.deepEqual(
      JSON.parse(String(titleUpdateCall.init?.body)).newTask,
      { id: 1, title: 'Updated title' }
    )

    const successfulFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (
        url.endsWith('/api/priority/setPriority') ||
        url.endsWith('/api/estimate/setEstimate')
      ) {
        return new Response(JSON.stringify({ message: 'Mutation failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return successfulFetch(input, init)
    }
    const sideEffectFailureResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: [
        { task_id: 1, priority: 1 },
        { task_id: 1, estimate: 2 },
      ],
    })
    const sideEffectFailureBody = await json(sideEffectFailureResponse)
    assert.deepEqual(
      sideEffectFailureBody.results.map(
        (result: { success: boolean; error?: string }) => ({
          success: result.success,
          error: result.error,
        })
      ),
      [
        {
          success: false,
          error:
            'Failed to update 1 task(s). Priority update failed: 500',
        },
        {
          success: false,
          error:
            'Failed to update 1 task(s). Estimate update failed: 500',
        },
      ]
    )
    globalThis.fetch = successfulFetch

    let activeUpdates = 0
    let maxActiveUpdates = 0
    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        activeUpdates += 1
        maxActiveUpdates = Math.max(maxActiveUpdates, activeUpdates)
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeUpdates -= 1
        const taskId = args.where.OR[0]?.id?.in[0] as number
        return [{ id: taskId, sectionId: 10, projectId: 20 }]
      }
      if (args.where.id?.in) {
        return args.where.id.in.map((id: number) => makeTask(id))
      }
      throw new Error('Unexpected task.findMany call')
    }

    const concurrencyResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: Array.from({ length: 12 }, (_, index) => ({
        task_id: index + 1,
        title: `Updated ${index + 1}`,
      })),
    })
    const concurrencyBody = await json(concurrencyResponse)
    assert.equal(concurrencyResponse.status, 200)
    assert.equal(concurrencyBody.results.length, 12)
    assert.equal(
      maxActiveUpdates,
      5,
      'batch update runs no more than five items concurrently'
    )

    let activeDuplicateUpdates = 0
    let maxActiveDuplicateUpdates = 0
    let duplicateLookupCount = 0
    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        duplicateLookupCount += 1
        activeDuplicateUpdates += 1
        maxActiveDuplicateUpdates = Math.max(
          maxActiveDuplicateUpdates,
          activeDuplicateUpdates
        )
        await new Promise((resolve) => setTimeout(resolve, 5))
        activeDuplicateUpdates -= 1
        return [{ id: 1, sectionId: 10, projectId: 20 }]
      }
      if (args.where.id?.in) {
        return [taskOne]
      }
      throw new Error('Unexpected task.findMany call')
    }
    const duplicateResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: [
        { task_id: 1, title: 'First title' },
        { task_id: 1, title: 'Second title' },
      ],
    })
    const duplicateBody = await json(duplicateResponse)
    assert.equal(duplicateResponse.status, 200)
    assert.equal(duplicateLookupCount, 2)
    assert.equal(
      maxActiveDuplicateUpdates,
      1,
      'updates for the same task are serialized'
    )
    assert.deepEqual(
      duplicateBody.results.map(
        (result: {
          task_id: number
          success: boolean
        }) => ({
          task_id: result.task_id,
          success: result.success,
        })
      ),
      [
        {
          task_id: 1,
          success: true,
        },
        {
          task_id: 1,
          success: true,
        },
      ]
    )

    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        return [{ id: 1, sectionId: 10, projectId: 20 }]
      }
      if (args.where.id?.in) {
        return [taskOne]
      }
      throw new Error('Unexpected task.findMany call')
    }
    const assigneeCallbackCalls: Array<{
      userIds: number[]
      intent: 'assign' | 'unassign'
    }> = []
    prismaMock.assignees.findMany = async (args: Record<string, any>) => {
      assert.deepEqual(args.where, { taskId: 1, agentId: null })
      assert.deepEqual(args.select, { userId: true })
      return [{ userId: 7 }]
    }
    const recursiveAssignCallsBefore = fetchCalls.filter((call) =>
      call.url.endsWith('/api/mcp/assignees/assign')
    ).length
    const assigneeResponse = await handleBatchBody(
      request,
      ctx,
      {
        op: 'update',
        updates: [{ task_id: 1, assignee: [6] }],
      },
      {
        assignAssignees: async (input) => {
          assert.equal(input.taskId, 1)
          assert.equal(input.projectId, 20)
          assert.equal(input.agentId, null)
          assigneeCallbackCalls.push({
            userIds: input.userIds,
            intent: input.intent,
          })
        },
      }
    )
    const assigneeBody = await json(assigneeResponse)
    assert.equal(assigneeResponse.status, 200)
    assert.deepEqual(assigneeCallbackCalls, [
      { userIds: [7], intent: 'unassign' },
      { userIds: [6], intent: 'assign' },
    ])
    assert.equal(assigneeBody.results[0].success, true)
    assert.equal(
      fetchCalls.filter((call) =>
        call.url.endsWith('/api/mcp/assignees/assign')
      ).length,
      recursiveAssignCallsBefore,
      'batch assignee updates do not make nested rate-limited MCP requests'
    )

    assigneeCallbackCalls.length = 0
    const clearedTaskIds: number[] = []
    const clearAssigneesResponse = await handleBatchBody(
      request,
      ctx,
      {
        op: 'update',
        updates: [{ task_id: 1, assignee: [] }],
      },
      {
        assignAssignees: async () => assert.fail('clear must use the atomic handler'),
        clearAssignees: async (input) => {
          clearedTaskIds.push(input.taskId)
        },
      }
    )
    const clearAssigneesBody = await json(clearAssigneesResponse)
    assert.equal(clearAssigneesResponse.status, 200)
    assert.equal(clearAssigneesBody.results[0].success, true)
    assert.deepEqual(assigneeCallbackCalls, [])
    assert.deepEqual(clearedTaskIds, [1])

    prismaMock.assignees.findMany = async () => []

    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        const taskIds = args.where.OR[0]?.id?.in as number[]
        return taskIds.includes(1)
          ? [{ id: 1, sectionId: 10, projectId: 20 }]
          : []
      }
      if (args.where.id?.in) {
        return args.where.id.in.includes(1) ? [taskOne] : []
      }
      throw new Error('Unexpected task.findMany call')
    }
    const accessResponse = await handleBatchBody(request, ctx, {
      op: 'update',
      updates: [
        { task_id: 1, title: 'Accessible update' },
        { task_id: 999, title: 'Inaccessible update' },
      ],
    })
    const accessBody = await json(accessResponse)
    assert.equal(accessResponse.status, 200)
    assert.deepEqual(
      accessBody.results.map(
        (result: {
          task_id: number
          success: boolean
          code?: string
        }) => ({
          task_id: result.task_id,
          success: result.success,
          code: result.code,
        })
      ),
      [
        { task_id: 1, success: true, code: undefined },
        { task_id: 999, success: false, code: 'not_found' },
      ]
    )
    assert.equal(accessBody.results[1].field, 'task_id')
    assert.match(accessBody.results[1].error, /not found or access denied/i)
  } finally {
    prismaMock.task.findMany = originalTaskFindMany
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.assignees.findMany = originalAssigneesFindMany
    globalThis.fetch = originalFetch
  }
}

void demo().then(() => {
  console.log('batch.test.ts: all assertions passed')
})
