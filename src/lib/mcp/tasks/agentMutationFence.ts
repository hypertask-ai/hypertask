import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import { taskWriteAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import { randomUUID } from 'node:crypto'

import type { Prisma } from '@prisma/client'

import {
  consumeAgentMutationLeaseAdoption,
  hasAgentMutationLeaseAdoptionScope,
  hasRecordedAgentMutationLeaseToken,
  recordAgentMutationLeaseToken,
} from './agentMutationLeaseAdoption'

const AGENT_MUTATION_LOCK_NAMESPACE = 1213482324

type ActiveTaskLeaseRow = {
  agentId: string | null
  token: string | null
  adoptionCount: number
}

export class AgentMutationLeaseConflictError extends Error {
  readonly status = 409
  readonly code: string = 'agent_mutation_lease_conflict'

  constructor(message?: string) {
    super(
      message ??
        'Task has an active agent mutation lease. Retry after the current action finishes.'
    )
    this.name = 'AgentMutationLeaseConflictError'
  }
}

export class AgentMutationLeaseMissingError extends AgentMutationLeaseConflictError {
  readonly code = 'agent_mutation_lease_missing'

  constructor() {
    super(
      'Caller holds no agent mutation lease for this task. Claim one with POST /mcp/tasks/lease/claim before this write.'
    )
    this.name = 'AgentMutationLeaseMissingError'
  }
}

export class TaskTeamScopeError extends Error {
  readonly status = 404
  readonly code = 'task_not_found'

  constructor() {
    super('Task not found or access denied')
    this.name = 'TaskTeamScopeError'
  }
}

export async function lockAgentMutationFence(
  tx: Prisma.TransactionClient,
  taskId: number
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      CAST(${AGENT_MUTATION_LOCK_NAMESPACE} AS integer),
      CAST(${taskId} AS integer)
    )
  `
}

async function adoptAgentMutationLease(
  tx: Prisma.TransactionClient,
  taskId: number,
  agentId: string,
  userId: number,
  options: { allowNonNormalLeaseAdoption?: boolean } = {}
): Promise<boolean> {
  const grant = consumeAgentMutationLeaseAdoption(agentId, userId, taskId)
  if (!grant) return false

  const liveTask = await tx.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  })
  if (
    !options.allowNonNormalLeaseAdoption &&
    liveTask?.status !== 'Normal'
  ) {
    return false
  }
  if (!liveTask) return false

  const token = randomUUID()
  const referenceToken = `${token}:${randomUUID()}`
  const rows = await tx.$queryRaw<Array<{ taskId: number }>>`
    INSERT INTO "TaskLease" ("taskId", "holder", "agentId", "token", "adoptionCount", "adoptionRefs", "expiresAt", "heartbeatAt")
    VALUES (${taskId}, ${userId}, ${agentId}, ${token}, 1, ARRAY[${referenceToken}]::TEXT[], now() + (${grant.ttlSeconds} * INTERVAL '1 second'), now())
    ON CONFLICT ("taskId") DO UPDATE SET
      "holder" = EXCLUDED."holder",
      "agentId" = EXCLUDED."agentId",
      "token" = EXCLUDED."token",
      "adoptionCount" = EXCLUDED."adoptionCount",
      "adoptionRefs" = EXCLUDED."adoptionRefs",
      "expiresAt" = EXCLUDED."expiresAt",
      "heartbeatAt" = EXCLUDED."heartbeatAt"
    WHERE "TaskLease"."expiresAt" <= now()
    RETURNING "taskId"
  `
  const adopted = rows.length > 0
  if (adopted) {
    recordAgentMutationLeaseToken(
      agentId,
      userId,
      taskId,
      token,
      referenceToken
    )
  }
  return adopted
}

async function joinAdoptedAgentMutationLease(
  tx: Prisma.TransactionClient,
  taskId: number,
  agentId: string,
  userId: number,
  token: string
): Promise<boolean> {
  const grant = consumeAgentMutationLeaseAdoption(agentId, userId, taskId)
  if (!grant) return false

  const referenceToken = `${token}:${randomUUID()}`
  const rows = await tx.$queryRaw<Array<{ taskId: number }>>`
    UPDATE "TaskLease"
    SET
      "adoptionCount" = "adoptionCount" + 1,
      "adoptionRefs" = array_append("adoptionRefs", ${referenceToken}),
      "expiresAt" = GREATEST(
        "expiresAt",
        now() + (${grant.ttlSeconds} * INTERVAL '1 second')
      ),
      "heartbeatAt" = now()
    WHERE "taskId" = ${taskId}
      AND "holder" = ${userId}
      AND "agentId" = ${agentId}
      AND "token" = ${token}
      AND EXISTS (
        SELECT 1
        FROM unnest("adoptionRefs") AS lease_reference(id)
        WHERE lease_reference.id LIKE ${`${token}:%`}
      )
      AND "adoptionCount" > 0
      AND "expiresAt" > now()
    RETURNING "taskId"
  `
  const joined = rows.length > 0
  if (joined) {
    recordAgentMutationLeaseToken(
      agentId,
      userId,
      taskId,
      token,
      referenceToken
    )
  }
  return joined
}

export async function assertAgentAssignmentChangeAllowed(
  tx: Prisma.TransactionClient,
  taskId: number,
  actingAgentId?: string | null,
  actingUserId?: number | null,
  options: {
    allowHumanOverride?: boolean
    teamScope?: AgentTokenTeamScope | null
    allowNonNormalLeaseAdoption?: boolean
  } = {}
): Promise<void> {
  await lockAgentMutationFence(tx, taskId)
  if (options.teamScope != null) {
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`
    if (actingUserId == null || !await tx.task.findFirst({
      where: { id: taskId, project: taskWriteAccessWhere(actingUserId, actingAgentId, options.teamScope) },
      select: { id: true },
    })) throw new TaskTeamScopeError()
  }
  const [lease] = await tx.$queryRaw<ActiveTaskLeaseRow[]>`
    SELECT "agentId", "token", "adoptionCount"
    FROM "TaskLease"
    WHERE "taskId" = ${taskId}
      AND "expiresAt" > now()
    LIMIT 1
  `
  let verifiedActingAgentId: string | null = null
  if (
    actingAgentId &&
    actingUserId != null
  ) {
    const ownedAgent = await tx.agent.findFirst({
      where: {
        id: actingAgentId,
        userId: actingUserId,
        revokedAt: null,
      },
      select: { id: true },
    })
    verifiedActingAgentId = ownedAgent?.id ?? null
  }
  const activeLease = lease != null
  if (actingAgentId) {
    if (activeLease && lease.agentId === verifiedActingAgentId) {
      if (verifiedActingAgentId && actingUserId != null) {
        if (lease.token && lease.adoptionCount > 0) {
          if (
            !hasAgentMutationLeaseAdoptionScope(
              verifiedActingAgentId,
              actingUserId
            )
          ) {
            return
          }
          if (
            hasRecordedAgentMutationLeaseToken(
              verifiedActingAgentId,
              actingUserId,
              taskId,
              lease.token
            )
          ) {
            return
          }
          if (
            await joinAdoptedAgentMutationLease(
              tx,
              taskId,
              verifiedActingAgentId,
              actingUserId,
              lease.token
            )
          ) {
            return
          }
          throw new AgentMutationLeaseConflictError()
        }

        consumeAgentMutationLeaseAdoption(
          verifiedActingAgentId,
          actingUserId,
          taskId
        )
      }
      return
    }
    if (!activeLease) {
      if (
        verifiedActingAgentId &&
        (await adoptAgentMutationLease(
          tx,
          taskId,
          verifiedActingAgentId,
          actingUserId as number,
          {
            allowNonNormalLeaseAdoption: options.allowNonNormalLeaseAdoption,
          }
        ))
      ) {
        return
      }
      throw new AgentMutationLeaseMissingError()
    }
    throw new AgentMutationLeaseConflictError()
  }
  if (!activeLease) return
  if (
    options.allowHumanOverride &&
    actingUserId != null
  ) {
    return
  }
  throw new AgentMutationLeaseConflictError()
}

export async function cancelAgentMutationLeaseForHumanOverride(
  tx: Prisma.TransactionClient,
  taskId: number,
  actingUserId: number
): Promise<void> {
  if (!Number.isInteger(actingUserId) || actingUserId <= 0) {
    throw new AgentMutationLeaseConflictError()
  }
  await lockAgentMutationFence(tx, taskId)
  await tx.taskLease.deleteMany({ where: { taskId } })
}
