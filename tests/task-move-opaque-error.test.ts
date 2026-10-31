import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { NextRequest } from 'next/server'

async function main() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'task-move-opaque-error-test-secret'
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  process.env.FIREBASE_SERVICE_ACCOUNT_B64 = Buffer.from(
    JSON.stringify({
      project_id: 'test-project',
      client_email: 'test@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    })
  ).toString('base64')

  const [{ default: prisma }, { executeTaskUpdate }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/tasks/updateTask'),
  ])

  const prismaMock = prisma as any
  const originals = {
    taskFindMany: prismaMock.task.findMany,
    userFindUnique: prismaMock.user.findUnique,
    assigneesFindMany: prismaMock.assignees.findMany,
    sectionFindUnique: prismaMock.section.findUnique,
    flagFindUnique: prismaMock.featureFlag.findUnique,
    flagFindMany: prismaMock.featureFlag.findMany,
    fetch: globalThis.fetch,
  }

  const runMoveUpdate = () =>
    executeTaskUpdate({
      request: new NextRequest('http://localhost/api/mcp/tasks/update', {
        method: 'POST',
      }),
      ctx: {
        teamScope: null,
        user: { id: 6, email: 'valentin@example.com' },
        agentId: null,
      },
      requestBody: { task_id: 1, sectionId: 5511 },
    })

  try {
    prismaMock.task.findMany = async (args: Record<string, any>) => {
      if (args.where.OR) {
        return [{ id: 1, sectionId: 10, projectId: 20, status: 'Normal' }]
      }
      throw new Error('Unexpected task.findMany call')
    }
    prismaMock.user.findUnique = async () => ({
      id: 6,
      email: 'valentin@example.com',
      displayName: 'Valentin',
      photoURL: null,
    })
    prismaMock.assignees.findMany = async () => []
    prismaMock.featureFlag.findUnique = async () => null
    prismaMock.featureFlag.findMany = async () => []
    prismaMock.section.findUnique = async () => ({
      section_title: 'QA',
      projectId: 20,
    })

    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      assert.ok(
        url.endsWith('/api/tasks/moveTask'),
        'section moves call the internal moveTask API'
      )
      return new Response('', { status: 500 })
    }

    const opaque = await runMoveUpdate()
    const opaqueBody = await opaque.response.json()
    assert.equal(opaque.response.status, 500)
    assert.equal(opaqueBody.success, false)
    assert.equal(
      opaqueBody.error,
      'Failed to update 1 task(s). Move task failed: 500'
    )

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'Section locked by a QA hold' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })

    const reasoned = await runMoveUpdate()
    const reasonedBody = await reasoned.response.json()
    assert.equal(reasoned.response.status, 409)
    assert.equal(reasonedBody.code, 'task_move_refused')
    assert.equal(
      reasonedBody.error,
      'Failed to update 1 task(s). Section locked by a QA hold'
    )
  } finally {
    prismaMock.task.findMany = originals.taskFindMany
    prismaMock.user.findUnique = originals.userFindUnique
    prismaMock.assignees.findMany = originals.assigneesFindMany
    prismaMock.section.findUnique = originals.sectionFindUnique
    prismaMock.featureFlag.findUnique = originals.flagFindUnique
    prismaMock.featureFlag.findMany = originals.flagFindMany
    globalThis.fetch = originals.fetch
  }
}

void main().then(() => {
  console.log('task-move-opaque-error.test.ts: all assertions passed')
})
