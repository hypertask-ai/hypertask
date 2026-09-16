// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/lib/mcp/agents/getOwnedAgent.test.ts
import type { PrismaClient } from '@prisma/client'
import assert from 'node:assert/strict'
import { getOwnedAgent } from './ownedAgents'

async function demo() {
  const row = {
    id: 'a0e75f8c-9080-47bd-b09a-71c55bd34a87',
    displayName: 'Cursor Dev 2',
    revokedAt: null,
    createdAt: new Date('2026-09-14T21:24:05.879Z'),
    visibility: 'PRIVATE' as const,
    prompt: 'Look up an agent purpose without grepping configs.',
    members: [
      { project: { id: 15, name: 'hypertasks', title: 'Hypertask Product' } },
      { project: { id: 15, name: 'hypertasks-dup', title: 'Hypertask Product' } },
    ],
  }

  let seenWhere: unknown
  const database = {
    agent: {
      async findFirst(args: { where: { id: string; userId: number } }) {
        seenWhere = args.where
        if (args.where.id !== row.id || args.where.userId !== 6) return null
        return row
      },
    },
  } as unknown as Pick<PrismaClient, 'agent'>

  const found = await getOwnedAgent(database, 6, row.id)
  assert.deepEqual(seenWhere, {
    id: row.id,
    userId: 6,
    archivedAt: null,
  })
  assert.deepEqual(found, {
    id: row.id,
    display_name: 'Cursor Dev 2',
    revoked: false,
    created_at: '2026-09-14T21:24:05.879Z',
    visibility: 'PRIVATE',
    prompt: 'Look up an agent purpose without grepping configs.',
    boards: [{ id: 15, name: 'Hypertask Product' }],
  })

  const missing = await getOwnedAgent(database, 6, 'missing-agent')
  assert.equal(missing, null)

  console.log('getOwnedAgent.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
