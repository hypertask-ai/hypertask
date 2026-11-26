import { agentIdSchema, type AgentId, type UserId } from "@/lib/identity"
import type { Prisma } from '@prisma/client'

import type { AgentTokenTeamScope } from '@/lib/mcp/auth'

export type AgentLifecycleRow = {
  id: AgentId
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

type OwnedAgentWhere = Prisma.AgentWhereInput & { id: AgentId; userId: UserId }

export type AgentLifecycleRecord = Omit<AgentLifecycleRow, "id"> & { id: string }

export type AgentLifecycleDatabase = {
  agent: {
    findFirst(args: {
      where: OwnedAgentWhere
      select: typeof LIFECYCLE_SELECT
    }): Promise<AgentLifecycleRecord | null>
    updateMany(args: {
      where: OwnedAgentWhere
      data: Prisma.AgentUpdateManyMutationInput
    }): Promise<{ count: number }>
  }
  user: {
    findUnique(args: {
      where: { id: UserId }
      select: { email: true }
    }): Promise<{ email: string } | null>
  }
}

async function findLifecycleAgent(
  database: AgentLifecycleDatabase,
  where: OwnedAgentWhere
): Promise<AgentLifecycleRow | null> {
  const row = await database.agent.findFirst({ where, select: LIFECYCLE_SELECT })
  return row ? { ...row, id: agentIdSchema.parse(row.id) } : null
}

export type AgentLifecycleDeps = {
  mintToken(
    userId: UserId,
    email: string,
    agentId: AgentId,
    teamScope?: AgentTokenTeamScope
  ): string
  clearRuntime(agentId: AgentId): Promise<void>
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
  userId: UserId,
  agentId: AgentId,
  scopeWhere: Prisma.AgentWhereInput = {},
  tokenTeamScope?: AgentTokenTeamScope
): Promise<LaunchOwnedAgentResult> {
  const existing = await findLifecycleAgent(database, { ...scopeWhere, id: agentId, userId })
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

  const current = await findLifecycleAgent(database, { ...scopeWhere, id: existing.id, userId })
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
  userId: UserId,
  agentId: AgentId,
  archived: boolean,
  scopeWhere: Prisma.AgentWhereInput = {}
): Promise<ArchiveOwnedAgentResult> {
  const existing = await findLifecycleAgent(database, { ...scopeWhere, id: agentId, userId })
  if (!existing) return { status: 'not_found' }

  const archivedAt = archived ? (existing.archivedAt ?? new Date()) : null
  if (
    (existing.archivedAt === null ? null : existing.archivedAt.getTime()) ===
    (archivedAt === null ? null : archivedAt.getTime())
  ) {
    return { status: 'ok', agent: existing }
  }

  const transition = await database.agent.updateMany({
    where: { ...scopeWhere, id: existing.id, userId },
    data: { archivedAt },
  })
  if (transition.count !== 1) return { status: 'not_found' }

  const agent = await findLifecycleAgent(database, { ...scopeWhere, id: existing.id, userId })
  if (!agent) return { status: 'not_found' }
  return { status: 'ok', agent }
}

export type RenameOwnedAgentResult =
  | { status: 'not_found' }
  | { status: 'ok'; agent: AgentLifecycleRow }

export async function renameOwnedAgent(
  database: AgentLifecycleDatabase,
  userId: UserId,
  agentId: AgentId,
  displayName: string,
  scopeWhere: Prisma.AgentWhereInput = {}
): Promise<RenameOwnedAgentResult> {
  const existing = await findLifecycleAgent(database, { ...scopeWhere, id: agentId, userId })
  if (!existing) return { status: 'not_found' }

  if (existing.displayName === displayName) {
    return { status: 'ok', agent: existing }
  }

  const transition = await database.agent.updateMany({
    where: { ...scopeWhere, id: existing.id, userId },
    data: { displayName },
  })
  if (transition.count !== 1) return { status: 'not_found' }

  const agent = await findLifecycleAgent(database, { ...scopeWhere, id: existing.id, userId })
  if (!agent) return { status: 'not_found' }
  return { status: 'ok', agent }
}
