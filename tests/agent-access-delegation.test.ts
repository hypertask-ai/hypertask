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
  const originalFlagFindUnique = prismaMock.featureFlag.findUnique
  const originalAgentFindUnique = prismaMock.agent.findUnique
  const originalMemberFindMany = prismaMock.member.findMany

  let flagMode = 'EVERYONE'
  let role: string | undefined = 'admin'
  let ceoProjects = [101, 102]
  prismaMock.featureFlag.findUnique = async () => ({ mode: flagMode })
  prismaMock.agent.findUnique = async () => ({
    permissions: role ? { role } : {},
  })
  prismaMock.member.findMany = async ({ where }: any) =>
    ceoProjects
      .filter((id) => where.projectId.in.includes(id))
      .map((projectId) => ({ projectId }))

  const ctx = {
    user: { id: 6, email: 'owner@example.com' },
    agentId: 'ceo',
  } as any
  const input = (add: number[], remove: number[] = []) => ({
    agentId: 'manager',
    addProjectIds: add,
    removeProjectIds: remove,
  })

  try {
    // Humans and management keys are untouched by this check.
    assert.equal(
      await checkAgentBoardDelegation({ ...ctx, agentId: undefined }, 'x', input([999])),
      null
    )

    // Admin agent inside its own projects: allowed, add and remove.
    assert.equal(await checkAgentBoardDelegation(ctx, 'manager', input([101])), null)
    assert.equal(
      await checkAgentBoardDelegation(ctx, 'dev-1', input([], [102])),
      null
    )

    // A project the acting agent is not on is outside its delegated scope.
    const outside = await json(
      await checkAgentBoardDelegation(ctx, 'manager', input([101, 555]))
    )
    assert.equal(outside.status, 403)
    assert.equal(outside.body.code, 'outside_delegated_scope')
    assert.match(outside.body.error, /project 555/)

    // An agent cannot widen its own access.
    const self = await json(await checkAgentBoardDelegation(ctx, 'ceo', input([101])))
    assert.equal(self.status, 403)
    assert.equal(self.body.error, 'An agent cannot change its own board access')

    // Write-role agents keep the old rejection path via insufficient_scope.
    role = 'write'
    const writer = await json(
      await checkAgentBoardDelegation(ctx, 'manager', input([101]))
    )
    assert.equal(writer.status, 403)
    assert.equal(writer.body.code, 'insufficient_scope')

    // Flag off: behaves exactly like before.
    role = 'admin'
    flagMode = 'OFF'
    const flagOff = await json(
      await checkAgentBoardDelegation(ctx, 'manager', input([101]))
    )
    assert.equal(flagOff.status, 403)
    assert.equal(flagOff.body.error, 'Agents cannot manage agents')

    // Removal from a board the CEO has left is also refused.
    flagMode = 'EVERYONE'
    ceoProjects = [101]
    const removeOutside = await json(
      await checkAgentBoardDelegation(ctx, 'dev-1', input([], [102]))
    )
    assert.equal(removeOutside.status, 403)
  } finally {
    prismaMock.featureFlag.findUnique = originalFlagFindUnique
    prismaMock.agent.findUnique = originalAgentFindUnique
    prismaMock.member.findMany = originalMemberFindMany
  }

  console.log('agent-access-delegation.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
