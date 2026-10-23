import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { NextRequest } from 'next/server'

function makeTask(id: number) {
  const timestamp = new Date('2026-09-01T12:00:00.000Z')
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
    riskLevel: null,
    acceptanceCriteria: null,
    verifyCommand: null,
    agent: null,
    assignees: [],
    followers: [],
    taskLabels: [],
    attachments: [],
    pullRequests: [
      {
        id: 'linked-pr',
        repositoryOwner: 'hypertask-ai',
        repositoryName: 'hypertask',
        number: 110,
        url: 'https://github.com/hypertask-ai/hypertask/pull/110',
        title: 'HTPR-5899 linked PR property',
        lifecycle: 'open',
        checkState: 'passing',
        headSha: 'abc123',
        updatedAt: timestamp,
      },
    ],
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

async function main() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'update-pull-request-test-secret'
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  process.env.FIREBASE_SERVICE_ACCOUNT_B64 = Buffer.from(
    JSON.stringify({
      project_id: 'test-project',
      client_email: 'test@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    })
  ).toString('base64')

  const [{ default: prisma }, { executeTaskUpdate }, { PullRequestLinkError }] =
    await Promise.all([
      import('@/lib/prisma'),
      import('@/lib/mcp/tasks/updateTask'),
      import('@/lib/pullRequests/taskPullRequests'),
    ])
  const prismaMock = prisma as any
  const originalTaskFindMany = prismaMock.task.findMany
  const originalUserFindUnique = prismaMock.user.findUnique
  const request = new NextRequest(
    'http://localhost/api/mcp/tasks/update',
    { method: 'POST' }
  )
  const ctx = {
    teamScope: null,
    user: { id: 6, email: 'valentin@example.com' },
    agentId: null,
  }
  const canonicalUrl =
    'https://github.com/hypertask-ai/hypertask/pull/110'
  const linkCalls: Array<Record<string, unknown>> = []
  const linkPullRequest = async (input: {
    taskId: number
    userId: number
    agentId?: string | null
    url: string
  }) => {
    linkCalls.push(input)
    return {
      created: true,
      pullRequest: {
        id: 'linked-pr',
        repositoryOwner: 'hypertask-ai',
        repositoryName: 'hypertask',
        number: 110,
        url: canonicalUrl,
        title: 'HTPR-5899 linked PR property',
        lifecycle: 'open' as const,
        checkState: 'pending' as const,
        displayState: 'open' as const,
        headSha: 'abc123',
        updatedAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    }
  }

  try {
    const invalid = await executeTaskUpdate({
      request,
      ctx,
      requestBody: {
        task_id: 1,
        pull_request_url: 'https://example.com/acme/app/pull/1',
      },
      linkPullRequest,
    })
    assert.equal(invalid.response.status, 400)
    assert.equal((await invalid.response.json()).field, 'pull_request_url')
    assert.equal(linkCalls.length, 0)

    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        return [{ id: 1, sectionId: 10, projectId: 20, status: 'Normal' }]
      }
      if (args.where.id?.in) return [makeTask(1)]
      throw new Error('Unexpected task.findMany call')
    }
    prismaMock.user.findUnique = async () => ({
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
      photoURL: null,
    })

    const dryRun = await executeTaskUpdate({
      request,
      ctx,
      requestBody: {
        task_id: 1,
        pull_request_url:
          'https://github.com/Hypertask-AI/Hypertask/pull/110/',
      },
      dryRun: true,
      linkPullRequest,
    })
    const dryRunBody = await dryRun.response.json()
    assert.equal(dryRun.response.status, 200)
    assert.equal(dryRunBody.would.request.pull_request_url, canonicalUrl)
    assert.equal(linkCalls.length, 0)

    const linked = await executeTaskUpdate({
      request,
      ctx,
      requestBody: { task_id: 1, pull_request_url: canonicalUrl },
      linkPullRequest,
    })
    assert.equal(linked.response.status, 200)
    assert.deepEqual(linkCalls, [
      {
        taskId: 1,
        userId: 6,
        agentId: null,
        url: canonicalUrl,
      },
    ])
    const linkedBody = await linked.response.json()
    assert.equal(linkedBody.task.pullRequests[0].displayState, 'green')
    assert.equal(linkedBody.task.pullRequests[0].updatedAt, '2026-09-01T12:00:00.000Z')

    const conflict = await executeTaskUpdate({
      request,
      ctx,
      requestBody: { task_id: 1, pull_request_url: canonicalUrl },
      linkPullRequest: async () => {
        throw new PullRequestLinkError(
          'Pull request is already linked to a task',
          409,
          'pr_already_linked',
        )
      },
    })
    assert.equal(conflict.response.status, 409)
    assert.equal((await conflict.response.json()).code, 'pr_already_linked')

    const linkFailingWith = async (error: Error) => {
      const original = { error: console.error, warn: console.warn }
      const logged: Array<['error' | 'warn', string]> = []
      console.error = (...args: unknown[]) => { logged.push(['error', String(args[0])]) }
      console.warn = (...args: unknown[]) => { logged.push(['warn', String(args[0])]) }
      try {
        const result = await executeTaskUpdate({
          request,
          ctx,
          requestBody: { task_id: 1, pull_request_url: canonicalUrl },
          linkPullRequest: async () => { throw error },
        })
        return { status: result.response.status, body: await result.response.json(), logged }
      } finally {
        Object.assign(console, original)
      }
    }

    const privateRepo = await linkFailingWith(
      new PullRequestLinkError('Pull request not found', 404, 'pr_not_found'),
    )
    assert.equal(privateRepo.status, 404)
    assert.equal(privateRepo.body.code, 'pr_not_found')
    assert.deepEqual(
      privateRepo.logged.filter(([level]) => level === 'error'),
      [],
      'a pull request GitHub cannot find is a caller mistake, not a server error (HTPR-7279)',
    )
    assert.ok(privateRepo.logged.some(([level, line]) => level === 'warn' && line.includes('task 1')))

    const githubDown = await linkFailingWith(
      new PullRequestLinkError('GitHub could not verify this pull request', 502, 'github_unavailable'),
    )
    assert.equal(githubDown.status, 502)
    assert.ok(githubDown.logged.some(([level, line]) => level === 'error' && line.includes('task 1')))

    const crash = await linkFailingWith(new Error('database down'))
    assert.equal(crash.status, 500)
    assert.ok(crash.logged.some(([level, line]) => level === 'error' && line.includes('task 1')))
  } finally {
    prismaMock.task.findMany = originalTaskFindMany
    prismaMock.user.findUnique = originalUserFindUnique
  }
}

void main().then(() => {
  console.log('updatePullRequest.test.ts: all assertions passed')
})
