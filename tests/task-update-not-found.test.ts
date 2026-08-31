import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { NextRequest } from 'next/server'

async function main() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.SESSION_SECRET = 'task-update-not-found-test-secret'
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
  const originalTaskFindMany = prismaMock.task.findMany

  try {
    prismaMock.task.findMany = async () => []

    const result = await executeTaskUpdate({
      request: new NextRequest('http://localhost/api/mcp/tasks/update', {
        method: 'POST',
      }),
      ctx: {
        user: { id: 6, email: 'valentin@example.com' },
        agentId: null,
      },
      requestBody: { task_id: 5834, title: 'Updated title' },
    })
    const body = await result.response.json()

    assert.equal(result.outcome, 'not_found')
    assert.equal(result.response.status, 404)
    assert.deepEqual(body, {
      success: false,
      tasks: [],
      error: 'Task not found or access denied',
    })
  } finally {
    prismaMock.task.findMany = originalTaskFindMany
  }
}

void main().then(() => {
  console.log('task-update-not-found.test.ts: all assertions passed')
})
