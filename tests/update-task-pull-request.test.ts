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
  const originalTransaction = prismaMock.$transaction
  const originalAgentFindUnique = prismaMock.agent.findUnique
  const request = new NextRequest(
    'http://localhost/api/mcp/tasks/update',
    { method: 'POST' }
  )
  const ctx = {
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

    // Enrollment can become active after the early contract-field check.
    // Exercise the real final guard and error response, with no task write.
    prismaMock.agent.findUnique = async () => ({ permissions: { role: 'write' } })
    let policyReads = 0
    let taskWrites = 0
    prismaMock.$transaction = async (callback: any) => callback({
      $executeRaw: async () => 1,
      $queryRaw: async () => [{ agentId: 'factory-dev', token: 'lease', adoptionCount: 0 }],
      agent: { findFirst: async () => ({ id: 'factory-dev' }) },
      task: { findUniqueOrThrow: async () => makeTask(1), update: async () => { taskWrites++; return makeTask(1) } },
      factoryEnrollment: { findUnique: async () => ({ projectId: 20, enabled: ++policyReads > 1, version: 1, agentRoles: { 'factory-dev': 'dev' }, sections: {} }) },
    })
    const raced = await executeTaskUpdate({
      request, ctx: { ...ctx, agentId: 'factory-dev' },
      requestBody: { task_id: 1, acceptance_criteria: 'Changed after enrollment' },
      linkPullRequest,
    })
    assert.equal(raced.response.status, 403)
    assert.equal((await raced.response.json()).code, 'factory_contract_owner_required')
    assert.equal(policyReads, 2)
    assert.equal(taskWrites, 0)
    prismaMock.$transaction = originalTransaction

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
  } finally {
    prismaMock.task.findMany = originalTaskFindMany
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.$transaction = originalTransaction
    prismaMock.agent.findUnique = originalAgentFindUnique
  }
}

void main().then(() => {
  console.log('updatePullRequest.test.ts: all assertions passed')
})
