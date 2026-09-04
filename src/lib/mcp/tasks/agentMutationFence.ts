import { randomUUID } from 'node:crypto'

import type { Prisma } from '@prisma/client'

import {
  consumeAgentMutationLeaseAdoption,
  hasAgentMutationLeaseAdoptionScope,
  hasRecordedAgentMutationLeaseToken,
  recordAgentMutationLeaseToken,
} from './agentMutationLeaseAdoption'

// Assignment changes and autonomous mutation leases take the same transaction
// lock. This closes the read-check-write gap without holding a database
// connection for the duration of an agent action.
const AGENT_MUTATION_LOCK_NAMESPACE = 1213482324

type ActiveTaskLeaseRow = {
  agentId: string | null
  token: string | null
  adoptionCount: number
}

export class AgentMutationLeaseConflictError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Task has an active agent mutation lease. Retry after the current action finishes.'
    )
    this.name = 'AgentMutationLeaseConflictError'
  }
}

// An agent that holds no lease and an agent blocked by someone else's lease are
// different failures with different remedies: claim a lease, or wait. Reporting
// both as an active conflict makes a caller that simply never claimed back off
// as though the task were owned elsewhere.
export class AgentMutationLeaseMissingError extends AgentMutationLeaseConflictError {
  constructor() {
    super(
      'Caller holds no agent mutation lease for this task. Claim one with POST /mcp/tasks/lease/claim before this write.'
    )
    this.name = 'AgentMutationLeaseMissingError'
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

// Adopts a lease for the current request, under the fence lock the caller
// already holds. Only reachable when the fence found no live lease and the
// request boundary opted in, and only for the first fenced transaction of that
// request. The insert keeps the claim endpoint's conditions: the task must
// still be Normal, and an unexpired row is never overwritten.
async function adoptAgentMutationLease(
  tx: Prisma.TransactionClient,
  taskId: number,
  agentId: string,
  userId: number
): Promise<boolean> {
  const grant = consumeAgentMutationLeaseAdoption(agentId, userId, taskId)
  if (!grant) return false

  const liveTask = await tx.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  })
  if (liveTask?.status !== 'Normal') return false

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
    // Remember which lease instance we created so the hand-back deletes that
    // exact row, not one the same agent later claimed explicitly.
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

// An overlapping invocation from the same agent joins the adopted row instead
// of merely trusting another call's reference. Its hand-back will decrement the
// count, so no invocation can expire the lease while another still uses it.
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
  options: { allowHumanOverride?: boolean } = {}
): Promise<void> {
  await lockAgentMutationFence(tx, taskId)
  // Leases are issued with PostgreSQL now(), so expiry must use that same
  // clock. Comparing with the API host clock can open the fence under skew.
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
    // Agent identity is never sufficient on its own. Every autonomous write
    // must still hold the live lease acquired for this operation. In
    // particular, a human cancellation removes the lease under this same
    // advisory lock, so a later transaction from a stale compound request is
    // rejected instead of treating the missing lease as permission.
    if (activeLease && lease.agentId === verifiedActingAgentId) {
      if (verifiedActingAgentId && actingUserId != null) {
        if (lease.token && lease.adoptionCount > 0) {
          // Internal child requests run outside the parent AsyncLocalStorage
          // scope. The parent cannot hand back until that request returns, so
          // it is safe for the child to use the parent's still-live reference.
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

        // Explicit claims have no active adoption references. Spend this
        // request's grant so cancellation still prevents a later re-adoption.
        consumeAgentMutationLeaseAdoption(
          verifiedActingAgentId,
          actingUserId,
          taskId
        )
      }
      return
    }
    if (!activeLease) {
      // One implicit adoption per request, for the agent this request
      // authenticated. Anything later in the same request must find the lease
      // that adoption created, so a human cancellation still fails closed.
      if (
        verifiedActingAgentId &&
        (await adoptAgentMutationLease(
          tx,
          taskId,
          verifiedActingAgentId,
          actingUserId as number
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
    // The caller may proceed to validate its intended human override while it
    // holds this transaction fence. It must cancel the lease only after proving
    // the mutation is still applicable, immediately before the write.
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
  // Re-taking a transaction-scoped advisory lock is safe and makes this helper
  // fail closed if a future caller forgets that validation and cancellation
  // must share the same transaction.
  await lockAgentMutationFence(tx, taskId)
  await tx.taskLease.deleteMany({ where: { taskId } })
}
