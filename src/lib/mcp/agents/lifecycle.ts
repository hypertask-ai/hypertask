/**
 * Shared agent lifecycle behaviour: rename, launch (switch a disabled agent
 * back on), and archive/unarchive.
 *
 * These sit behind `PATCH /api/mcp/agents/[agentId]`, so the CLI, the MCP
 * server and AI chat can bring an agent back to life from wherever the operator
 * happens to be (HTPR-5418). Behaviour lives here rather than in each client
 * wrapper, per the repository rule in CLAUDE.md.
 *
 * The database and the credential/runtime dependencies are arguments so the
 * rules can be tested without a database.
 */

export type AgentLifecycleRow = {
  id: string
  displayName: string
  photoURL: string | null
  revokedAt: Date | null
  archivedAt: Date | null
  runtimeType: string
  mcpTokenHash: string | null
  mcpTokenJti: string | null
}

const LIFECYCLE_SELECT = {
  id: true,
  displayName: true,
  photoURL: true,
  revokedAt: true,
  archivedAt: true,
  runtimeType: true,
  mcpTokenHash: true,
  mcpTokenJti: true,
} as const

export type AgentLifecycleDatabase = {
  agent: {
    findFirst(args: {
      where: { id: string; userId: number }
      select: typeof LIFECYCLE_SELECT
    }): Promise<AgentLifecycleRow | null>
    updateMany(args: {
      where: { id: string; userId: number; revokedAt: { not: null } }
      data: {
        revokedAt: null
        mcpTokenHash: string | null
        mcpTokenJti: string | null
        mcpTokenExpiresAt: null
        runtimeGeneration: { increment: number }
      }
    }): Promise<{ count: number }>
    update(args: {
      where: { id: string }
      data: { archivedAt?: Date | null; displayName?: string }
      select: typeof LIFECYCLE_SELECT
    }): Promise<AgentLifecycleRow>
  }
  user: {
    findUnique(args: {
      where: { id: number }
      select: { email: true }
    }): Promise<{ email: string } | null>
  }
}

export type AgentLifecycleDeps = {
  /** Mints a fresh agent-scoped MCP credential for an external agent. */
  mintToken(userId: number, email: string, agentId: string): string
  /** Best-effort runtime snapshot invalidation; failures must not block. */
  clearRuntime(agentId: string): Promise<void>
  /** Turns an issued credential into the digest columns the row stores. */
  credentialFields(token: string | null): {
    mcpTokenHash: string | null
    mcpTokenJti: string | null
  }
}

export type LaunchOwnedAgentResult =
  | { status: 'not_found' }
  | { status: 'owner_missing' }
  | { status: 'runtime_invalidation_failed' }
  | {
      status: 'ok'
      agent: AgentLifecycleRow
      /** Present only when a new credential was minted on this call. */
      token: string | null
      /** True when the agent was already running, so nothing changed. */
      alreadyRunning: boolean
    }

/**
 * Switches a disabled agent back on.
 *
 * Disabling destroys the credential, so an external agent gets a freshly minted
 * one that is revealed exactly once. The runtime snapshot is cleared first so an
 * in-flight heartbeat from the destroyed token cannot resurrect the old queue.
 */
export async function launchOwnedAgent(
  database: AgentLifecycleDatabase,
  deps: AgentLifecycleDeps,
  userId: number,
  agentId: string
): Promise<LaunchOwnedAgentResult> {
  const existing = await database.agent.findFirst({
    where: { id: agentId, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!existing) return { status: 'not_found' }

  // Launching a running agent is a no-op, not an error: a caller retrying after
  // a dropped response must not rotate a working credential out from under it.
  if (existing.revokedAt === null) {
    return { status: 'ok', agent: existing, token: null, alreadyRunning: true }
  }

  // Fail closed: the agent stays off if its old runtime snapshot cannot be
  // dropped, so a retry is the only way forward and no launch ever hands back
  // a credential while stale queued work might still be readable.
  try {
    await deps.clearRuntime(existing.id)
  } catch (error) {
    console.warn('[Agent runtime] Snapshot invalidation failed:', error)
    return { status: 'runtime_invalidation_failed' }
  }

  let issuedCredential: string | null = null
  if (existing.runtimeType === 'EXTERNAL') {
    const owner = await database.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    if (!owner) return { status: 'owner_missing' }
    issuedCredential = deps.mintToken(userId, owner.email, existing.id)
  }

  const transition = await database.agent.updateMany({
    where: { id: existing.id, userId, revokedAt: { not: null } },
    data: {
      revokedAt: null,
      ...deps.credentialFields(issuedCredential),
      mcpTokenExpiresAt: null,
      runtimeGeneration: { increment: 1 },
    },
  })

  const current = await database.agent.findFirst({
    where: { id: existing.id, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!current) return { status: 'not_found' }

  // Another tab won the transition: report the live state and reveal nothing,
  // because the credential this call minted was never stored.
  if (transition.count === 0) {
    return { status: 'ok', agent: current, token: null, alreadyRunning: true }
  }

  // Reveal the plaintext only when this call is the one that stored it. The
  // credential is not readable back out of the row, so the digest is what says
  // whether this token is the live one.
  const revealed =
    issuedCredential &&
    current.revokedAt === null &&
    deps.credentialFields(issuedCredential).mcpTokenHash === current.mcpTokenHash
      ? issuedCredential
      : null

  return { status: 'ok', agent: current, token: revealed, alreadyRunning: false }
}

export type ArchiveOwnedAgentResult =
  | { status: 'not_found' }
  | { status: 'ok'; agent: AgentLifecycleRow }

/**
 * Files an agent away, or brings it back into the register.
 *
 * Archiving is about visibility, not power: it never touches the credential or
 * the switch, so an archived agent that is still running keeps working.
 */
export async function archiveOwnedAgent(
  database: AgentLifecycleDatabase,
  userId: number,
  agentId: string,
  archived: boolean
): Promise<ArchiveOwnedAgentResult> {
  const existing = await database.agent.findFirst({
    where: { id: agentId, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!existing) return { status: 'not_found' }

  const archivedAt = archived ? (existing.archivedAt ?? new Date()) : null
  if (
    (existing.archivedAt === null ? null : existing.archivedAt.getTime()) ===
    (archivedAt === null ? null : archivedAt.getTime())
  ) {
    return { status: 'ok', agent: existing }
  }

  const agent = await database.agent.update({
    where: { id: existing.id },
    data: { archivedAt },
    select: LIFECYCLE_SELECT,
  })
  return { status: 'ok', agent }
}

export type RenameOwnedAgentResult =
  | { status: 'not_found' }
  | { status: 'ok'; agent: AgentLifecycleRow }

/** Changes the display name of an agent owned by the caller. */
export async function renameOwnedAgent(
  database: AgentLifecycleDatabase,
  userId: number,
  agentId: string,
  displayName: string
): Promise<RenameOwnedAgentResult> {
  const existing = await database.agent.findFirst({
    where: { id: agentId, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!existing) return { status: 'not_found' }

  if (existing.displayName === displayName) {
    return { status: 'ok', agent: existing }
  }

  const agent = await database.agent.update({
    where: { id: existing.id },
    data: { displayName },
    select: LIFECYCLE_SELECT,
  })
  return { status: 'ok', agent }
}
