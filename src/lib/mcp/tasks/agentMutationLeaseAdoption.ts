import { AsyncLocalStorage } from 'node:async_hooks'

import { MIN_LEASE_TTL_SECONDS, clampLeaseTtlSeconds } from './lease'

// A lease is an internal concurrency device. Hand-rolled CLI and MCP sessions
// never call POST /mcp/tasks/lease/claim, so their first fenced write failed as
// though another agent owned the task. This lets an agent request adopt a lease
// implicitly, but only ONCE, at the request boundary.
//
// The single-use rule is the whole safety argument. Server-side an empty fence
// means either "never claimed" or "a human cancelled mid-turn" — the two are
// indistinguishable because the cancellation deletes the row. Adopting on every
// empty fence would let an agent keep writing after a cancellation. Adopting
// only on the first fenced transaction *for a given task* keeps the stale-
// compound-request protection intact: transaction two onward against that task
// must still find the live lease this request created. The key includes the
// task so a request that legitimately touches several tasks is not rejected on
// the second one.
type LeaseAdoptionState = {
  agentId: string
  userId: number
  ttlSeconds: number
  adoptedTaskIds: Set<number>
  // The token of the lease row this scope created or joined, per task. The
  // release must update that exact instance: (task, holder, agent)
  // alone also matches a lease the same agent explicitly re-claimed after our
  // adopted one expired, and deleting it would open the collision fence.
  leaseReferencesByTaskId: Map<
    number,
    { leaseToken: string; referenceToken: string }
  >
}

const adoptionStorage = new AsyncLocalStorage<LeaseAdoptionState>()

export type LeaseAdoptionGrant = {
  ttlSeconds: number
}

// Opt-in, per request. Routes that do not call this keep the strict behaviour.
export function withAgentMutationLeaseAdoption<T>(
  actor: {
    agentId?: string | null
    userId?: number | null
    ttlSeconds?: number
  },
  run: () => Promise<T>
): Promise<T> {
  const { agentId, userId } = actor
  if (!agentId || userId == null) return run()

  return adoptionStorage.run(
    {
      agentId,
      userId,
      // A route-level caller never releases the lease explicitly, because it
      // does not know it exists. Keep it at the shortest supported TTL so a
      // crashed request cannot park a task for the five minutes an explicit
      // claim gets. In-process callers that can hand it back should use
      // withAdoptedAgentMutationLease instead of waiting for expiry.
      ttlSeconds: clampLeaseTtlSeconds(
        actor.ttlSeconds ?? MIN_LEASE_TTL_SECONDS
      ),
      adoptedTaskIds: new Set<number>(),
      leaseReferencesByTaskId: new Map(),
    },
    run
  )
}

type LeaseAdoptionDb = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>
}

/**
 * Runs one agent-attributed unit of work inside an adopted mutation lease, then
 * hands the lease straight back.
 *
 * This is the shape an in-process caller wants: AI Chat executes a task write as
 * the agent, but never claimed a lease, so the fence rejected it as though
 * another agent owned the ticket. Scope this per unit of work, not per turn: a
 * chat turn can run for many minutes between steps, and a turn-wide adoption
 * would expire mid-turn and fail later writes with the same error it removes.
 *
 * A human caller passes no agentId and runs untouched, keeping the human
 * override path that cancels a stale agent lease instead of queueing behind it.
 */
export async function withAdoptedAgentMutationLease<T>(
  db: LeaseAdoptionDb,
  actor: { agentId?: string | null; userId?: number | null; ttlSeconds?: number },
  run: () => Promise<T>
): Promise<T> {
  return withAgentMutationLeaseAdoption(actor, async () => {
    try {
      return await run()
    } finally {
      try {
        await releaseAdoptedAgentMutationLeases(db)
      } catch (error) {
        // The write is already committed. A failed hand-back must not turn that
        // success into an error; lease expiry is the backstop.
        console.error('[agentMutationLeaseAdoption] release failed', error)
      }
    }
  })
}

// Releases the adopted lease references held by this scope. Overlapping calls
// from the same agent can join one row, so each hand-back removes one reference
// and only the final hand-back expires the row. The cleanup delete is safe to
// race with a new adoption because a replacement always mints a different token.
//
// Every statement matches the token the adoption insert minted (HTPR-5656), so
// it can only affect the exact lease instance this scope joined. Holder and agent
// alone are not enough: an expired adopted lease may already have been replaced
// by an explicit claim from the same agent.
//
// The caller passes its database client rather than this module importing one,
// which keeps the module free of Prisma for the fence tests that load it
// directly.
export async function releaseAdoptedAgentMutationLeases(
  db: LeaseAdoptionDb
): Promise<void> {
  const state = adoptionStorage.getStore()
  if (!state || state.adoptedTaskIds.size === 0) return

  // Sequential on purpose: this is normally one task, and firing raw deletes in
  // parallel buys nothing while competing for the connection pool.
  const taskIds = [...state.adoptedTaskIds]
  // Keep the ids recorded. Clearing them would re-arm adoption for this scope,
  // which is exactly the stale-compound-request hole the one-shot rule closes.
  for (const taskId of taskIds) {
    const reference = state.leaseReferencesByTaskId.get(taskId)
    // No reference means the adoption never materialized a row (the grant was
    // spent without an insert), so there is nothing of ours to delete.
    if (!reference) continue
    // The reference token is written in the same transaction as the count. If
    // that transaction rolled back, it is absent and cleanup cannot decrement
    // another call's committed reference.
    await db.$executeRaw`
      WITH lease_reference AS (SELECT ${reference.referenceToken}::text AS id)
      UPDATE "TaskLease"
      SET
        "adoptionRefs" = array_remove("TaskLease"."adoptionRefs", lease_reference.id),
        "adoptionCount" = "adoptionCount" - 1,
        "expiresAt" = CASE
          WHEN "adoptionCount" <= 1 THEN now()
          ELSE "expiresAt"
        END,
        "heartbeatAt" = now()
      FROM lease_reference
      WHERE "TaskLease"."taskId" = ${taskId}
        AND "TaskLease"."holder" = ${state.userId}
        AND "TaskLease"."agentId" = ${state.agentId}
        AND "TaskLease"."token" = ${reference.leaseToken}
        AND lease_reference.id = ANY("TaskLease"."adoptionRefs")
        AND "TaskLease"."adoptionCount" > 0
    `
    await db.$executeRaw`
      DELETE FROM "TaskLease"
      WHERE "taskId" = ${taskId}
        AND "holder" = ${state.userId}
        AND "agentId" = ${state.agentId}
        AND "token" = ${reference.leaseToken}
        AND "adoptionCount" = 0
    `
  }
}

// Records the token of the lease row the fence created or joined for this
// scope. The release later uses it to update only that lease instance.
export function recordAgentMutationLeaseToken(
  agentId: string,
  userId: number,
  taskId: number,
  leaseToken: string,
  referenceToken: string
): void {
  const state = adoptionStorage.getStore()
  if (!state) return
  if (state.agentId !== agentId || state.userId !== userId) return
  state.leaseReferencesByTaskId.set(taskId, { leaseToken, referenceToken })
}

export function hasAgentMutationLeaseAdoptionScope(
  agentId: string,
  userId: number
): boolean {
  const state = adoptionStorage.getStore()
  return state?.agentId === agentId && state.userId === userId
}

export function hasRecordedAgentMutationLeaseToken(
  agentId: string,
  userId: number,
  taskId: number,
  token: string
): boolean {
  const state = adoptionStorage.getStore()
  if (!state) return false
  if (state.agentId !== agentId || state.userId !== userId) return false
  return state.leaseReferencesByTaskId.get(taskId)?.leaseToken === token
}

// Returns a grant at most once per task per request, and only for the exact
// actor the request boundary authenticated. A different agent id or user id
// inside the same request gets nothing.
export function consumeAgentMutationLeaseAdoption(
  agentId: string,
  userId: number,
  taskId: number
): LeaseAdoptionGrant | null {
  const state = adoptionStorage.getStore()
  if (!state) return null
  if (state.agentId !== agentId || state.userId !== userId) return null
  if (state.adoptedTaskIds.has(taskId)) return null

  state.adoptedTaskIds.add(taskId)
  return { ttlSeconds: state.ttlSeconds }
}
