import { AsyncLocalStorage } from 'node:async_hooks'

import { MIN_LEASE_TTL_SECONDS, clampLeaseTtlSeconds } from './lease'

type LeaseAdoptionState = {
  agentId: string
  userId: number
  ttlSeconds: number
  adoptedTaskIds: Set<number>
  leaseReferencesByTaskId: Map<
    number,
    { leaseToken: string; referenceToken: string }
  >
}

const adoptionStorage = new AsyncLocalStorage<LeaseAdoptionState>()

export type LeaseAdoptionGrant = {
  ttlSeconds: number
}

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
        console.error('[agentMutationLeaseAdoption] release failed', error)
      }
    }
  })
}

export async function releaseAdoptedAgentMutationLeases(
  db: LeaseAdoptionDb
): Promise<void> {
  const state = adoptionStorage.getStore()
  if (!state || state.adoptedTaskIds.size === 0) return

  const taskIds = [...state.adoptedTaskIds]
  for (const taskId of taskIds) {
    const reference = state.leaseReferencesByTaskId.get(taskId)
    if (!reference) continue
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
