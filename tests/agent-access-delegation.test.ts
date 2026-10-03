// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx tests/agent-access-delegation.test.ts
import assert from 'node:assert/strict'

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

  const ctx = {
    user: { id: 6, email: 'owner@example.com' },
    agentId: 'ceo',
  } as any

  try {
    // Humans and management keys are untouched by this check.
    assert.equal(
      await checkAgentBoardDelegation({ ...ctx, agentId: undefined }, 'x'),
      null
    )

    // Admin agent acting on another agent: allowed (board scope is checked
    // inside updateOwnedAgentBoards).
    assert.equal(await checkAgentBoardDelegation(ctx, 'manager'), null)
    assert.equal(
      await checkAgentBoardDelegation(ctx, 'dev-1'),
      null
    )

    // An agent cannot widen its own access.
    const self = await json(await checkAgentBoardDelegation(ctx, 'ceo'))
    assert.equal(self.status, 403)
    assert.equal(self.body.error, 'An agent cannot change its own board access')

    // Write-role agents keep the old rejection path via insufficient_scope.
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
