import assert from 'node:assert/strict'
import type { McpAuthContext } from '../src/lib/mcp/auth/types'

async function json(response: Response | null) {
  assert.ok(response, 'expected a rejection response')
  return {
    status: response.status,
    body: (await response.json()) as Record<string, any>,
  }
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'agent-delegation-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'agent-delegation-test'
  process.env.SESSION_SECRET =
    'agent-delegation-session-secret-at-least-32-characters'

  const [{ default: prisma }, { checkAgentBoardDelegation }] =
    await Promise.all([
      import('@/lib/prisma'),
      import('@/lib/mcp/agents/delegatedAccess'),
    ])

  const prismaMock = prisma as any
  const originalAgentFindUnique = prismaMock.agent.findUnique

  let role: string | undefined = 'admin'
  prismaMock.agent.findUnique = async () => ({
    permissions: role ? { role } : {},
  })

  const ctx: McpAuthContext = {
    teamScope: null,
    user: { id: 6, email: 'owner@example.com' },
    agentId: 'ceo',
  }

  try {
    assert.equal(
      await checkAgentBoardDelegation({ ...ctx, agentId: null }, 'x'),
      null
    )

    assert.equal(await checkAgentBoardDelegation(ctx, 'manager'), null)
    assert.equal(
      await checkAgentBoardDelegation(ctx, 'dev-1'),
      null
    )

    const self = await json(await checkAgentBoardDelegation(ctx, 'ceo'))
    assert.equal(self.status, 403)
    assert.equal(self.body.error, 'An agent cannot change its own board access. Ask the person who owns this agent to open Agents, pick this agent, and add the board under Board access.')
    assert.equal(self.body.code, 'forbidden')

    role = 'write'
    const writer = await json(
      await checkAgentBoardDelegation(ctx, 'manager')
    )
    assert.equal(writer.status, 403)
    assert.equal(writer.body.code, 'insufficient_scope')

  } finally {
    prismaMock.agent.findUnique = originalAgentFindUnique
  }

  console.log('agent-access-delegation.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
