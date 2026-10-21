import type { Prisma } from '@prisma/client'

import type { AgentTokenTeamScope } from '@/lib/mcp/auth'

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

const isRecordNotFoundError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2025'

export type AgentLifecycleDatabase = {
  agent: {
    findFirst(args: {
      where: Prisma.AgentWhereInput
      select: typeof LIFECYCLE_SELECT
    }): Promise<AgentLifecycleRow | null>
    updateMany(args: {
      where: Prisma.AgentWhereInput
      data: {
        revokedAt: null
        mcpTokenHash: string | null
        mcpTokenJti: string | null
        mcpTokenExpiresAt: null
        credentialTeamId: string | null
        credentialTeamAccessBinding: string | null
        runtimeGeneration: { increment: number }
      }
    }): Promise<{ count: number }>
    update(args: {
      where: Prisma.AgentWhereUniqueInput
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
  mintToken(
    userId: number,
    email: string,
    agentId: string,
    teamScope?: AgentTokenTeamScope
  ): string
  clearRuntime(agentId: string): Promise<void>
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
      token: string | null
      alreadyRunning: boolean
    }

export async function launchOwnedAgent(
  database: AgentLifecycleDatabase,
  deps: AgentLifecycleDeps,
  userId: number,
  agentId: string,
  scopeWhere: Prisma.AgentWhereInput = {},
  tokenTeamScope?: AgentTokenTeamScope
): Promise<LaunchOwnedAgentResult> {
  const existing = await database.agent.findFirst({
    where: { ...scopeWhere, id: agentId, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!existing) return { status: 'not_found' }

  if (existing.revokedAt === null) {
    return { status: 'ok', agent: existing, token: null, alreadyRunning: true }
  }

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
    issuedCredential = deps.mintToken(
      userId,
      owner.email,
      existing.id,
      tokenTeamScope
    )
  }

  const transition = await database.agent.updateMany({
    where: {
      ...scopeWhere,
      id: existing.id,
      userId,
      revokedAt: { not: null },
    },
    data: {
      revokedAt: null,
      ...deps.credentialFields(issuedCredential),
      mcpTokenExpiresAt: null,
      credentialTeamId: tokenTeamScope?.teamId ?? null,
      credentialTeamAccessBinding: tokenTeamScope?.accessBinding ?? null,
      runtimeGeneration: { increment: 1 },
    },
  })

  const current = await database.agent.findFirst({
    where: { ...scopeWhere, id: existing.id, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!current) return { status: 'not_found' }

  if (transition.count === 0) {
    return { status: 'ok', agent: current, token: null, alreadyRunning: true }
  }

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

export async function archiveOwnedAgent(
  database: AgentLifecycleDatabase,
  userId: number,
  agentId: string,
  archived: boolean,
  scopeWhere: Prisma.AgentWhereInput = {}
): Promise<ArchiveOwnedAgentResult> {
  const existing = await database.agent.findFirst({
    where: { ...scopeWhere, id: agentId, userId },
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

  try {
    const agent = await database.agent.update({
      where: { ...scopeWhere, id: existing.id, userId },
      data: { archivedAt },
      select: LIFECYCLE_SELECT,
    })
    return { status: 'ok', agent }
  } catch (error) {
    if (isRecordNotFoundError(error)) return { status: 'not_found' }
    throw error
  }
}

export type RenameOwnedAgentResult =
  | { status: 'not_found' }
  | { status: 'ok'; agent: AgentLifecycleRow }

export async function renameOwnedAgent(
  database: AgentLifecycleDatabase,
  userId: number,
  agentId: string,
  displayName: string,
  scopeWhere: Prisma.AgentWhereInput = {}
): Promise<RenameOwnedAgentResult> {
  const existing = await database.agent.findFirst({
    where: { ...scopeWhere, id: agentId, userId },
    select: LIFECYCLE_SELECT,
  })
  if (!existing) return { status: 'not_found' }

  if (existing.displayName === displayName) {
    return { status: 'ok', agent: existing }
  }

  try {
    const agent = await database.agent.update({
      where: { ...scopeWhere, id: existing.id, userId },
      data: { displayName },
      select: LIFECYCLE_SELECT,
    })
    return { status: 'ok', agent }
  } catch (error) {
    if (isRecordNotFoundError(error)) return { status: 'not_found' }
    throw error
  }
}
