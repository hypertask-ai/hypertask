// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/tasks/related/related.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

function makeSearchRow(id: number) {
  return {
    id: String(id),
    ticketNumber: `HTPR-${id}`,
    title: `Task ${id}`,
    descriptionText: `Description ${id}`,
    projectId: id % 2 === 0 ? 7 : 9,
    creatorName: 'Valentin',
    status: 'Normal',
    updatedAt: '2026-07-27T12:00:00.000Z',
    searchText: `Task ${id} Description ${id}`,
    uniqueIndex: id,
    projectTitle: 'Test board',
    $dist: id / 100,
  }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'related-test-session-secret'

  const [
    { default: prisma },
    { handleRelatedTasksGet, handleRelatedTasksPost },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/tasks/relatedTasks'),
  ])

  const prismaMock = prisma as any
  const originalTaskFindFirst = prismaMock.task.findFirst
  const originalProjectFindMany = prismaMock.project.findMany
  const request = new NextRequest(
    'http://localhost/api/mcp/tasks/related',
    {
      headers: { Authorization: 'Bearer test-token' },
    }
  )
  const ctx = {
    user: { id: 6, email: 'valentin@example.com' },
    agentId: null,
  }
  const searchCalls: Array<Record<string, any>> = []
  const searchTasksMock = async (args: Record<string, any>) => {
    searchCalls.push(args)
    return [
      makeSearchRow(42),
      ...Array.from({ length: 30 }, (_, index) =>
        makeSearchRow(index + 43)
      ),
    ]
  }
  const dependencies = { searchTasks: searchTasksMock as any }

  try {
    prismaMock.task.findFirst = async (args: Record<string, any>) => {
      if (args.select?.title) {
        return {
          title: 'Source task',
          description_: { content: '<p>Source description</p>' },
        }
      }
      return { id: 42, projectId: 7 }
    }
    prismaMock.project.findMany = async (args: Record<string, any>) => {
      assert.equal(args.where.status, 'Normal')
      assert.deepEqual(args.select, { id: true })
      return [{ id: 7 }, { id: 9 }]
    }

    const getResponse = await handleRelatedTasksGet(
      request,
      ctx,
      { taskId: 42, limit: 10 },
      dependencies
    )
    const getBody = await json(getResponse)
    assert.equal(getResponse.status, 200)
    assert.equal(getBody.success, true)
    assert.deepEqual(
      searchCalls[0].projectIds,
      [7, 9],
      'searchTasks receives only the caller-accessible project IDs'
    )
    assert.equal(searchCalls[0].topK, 15)
    assert.equal(searchCalls[0].keywordOnly, false)
    assert.ok(
      getBody.related.every(
        (task: { ticketNumber: string }) =>
          task.ticketNumber !== 'HTPR-42'
      ),
      'the source task is excluded from related results'
    )
    assert.equal(
      getBody.related[0].url,
      'https://app.hypertask.ai/detail/project-9/43'
    )

    const callsBeforeDeniedGet = searchCalls.length
    prismaMock.task.findFirst = async () => null
    const deniedResponse = await handleRelatedTasksGet(
      request,
      ctx,
      { taskId: 999, limit: null },
      dependencies
    )
    const deniedBody = await json(deniedResponse)
    assert.equal(deniedResponse.status, 404)
    assert.equal(
      deniedBody.error,
      'Task not found or access denied'
    )
    assert.equal(
      searchCalls.length,
      callsBeforeDeniedGet,
      'a denied or missing task never triggers searchTasks'
    )

    const callsBeforeInvalidPost = searchCalls.length
    const emptyResponse = await handleRelatedTasksPost(
      request,
      ctx,
      { text: '   ' },
      dependencies
    )
    assert.equal(emptyResponse.status, 400)
    assert.equal(
      searchCalls.length,
      callsBeforeInvalidPost,
      'empty text never triggers searchTasks'
    )

    const longResponse = await handleRelatedTasksPost(
      request,
      ctx,
      { text: 'x'.repeat(2001) },
      dependencies
    )
    assert.equal(longResponse.status, 400)
    assert.equal(
      searchCalls.length,
      callsBeforeInvalidPost,
      'over-length text never triggers searchTasks'
    )

    const clampedResponse = await handleRelatedTasksPost(
      request,
      ctx,
      { text: 'Prior art query', limit: 100 },
      dependencies
    )
    const clampedBody = await json(clampedResponse)
    assert.equal(clampedResponse.status, 200)
    assert.equal(searchCalls.at(-1)?.topK, 25)
    assert.equal(clampedBody.related.length, 25)
  } finally {
    prismaMock.task.findFirst = originalTaskFindFirst
    prismaMock.project.findMany = originalProjectFindMany
  }
}

void demo().then(() => {
  console.log('related.test.ts: all assertions passed')
})
