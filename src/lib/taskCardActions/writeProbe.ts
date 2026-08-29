import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { withTaskStarWriteLock } from './writeLocks'

// HTPR-5467 — production-safe task-write probe.
//
// PR #2789 shipped a production-wide task-write outage: the two-argument
// `pg_advisory_xact_lock` overload was selected with bigint-bound parameters,
// PostgreSQL rejected it, and every task write failed. Production health checks
// only exercised READS (a homepage GET and GET /api/mcp/projects), so the
// broken write path was declared healthy and never rolled back.
//
// This module runs a REAL task-write — the exact advisory-lock helper from
// writeLocks.ts, followed by real writes through the Prisma transaction — and
// then ALWAYS rolls the transaction back by throwing a sentinel. The probe
// writes are never committed, so a successful probe leaves the data it
// exercises untouched.
//
// The probe NEVER borrows an existing task, and it NEVER creates one. It writes
// only to a dedicated probe task on a dedicated archived board owned by the
// authenticated caller, provisioned deliberately and out of band by
// scripts/ensure-task-write-probe-fixture.mjs. Missing fixture = inconclusive.
// Locking whichever task happened to have the lowest id meant a health check on
// one account taking an advisory lock on, and writing to, another tenant's row;
// creating the fixture from the endpoint meant a deploy silently minting
// user-visible records.
//
// Why this is safe:
//   * The lock is acquired through `withTaskStarWriteLock` (the same wrapper
//     used by every human star/`savedContent` write, AND the same `withTaskWriteLock`
//     core the Inbox/reminder path shares). If the lock helper breaks, the
//     transaction throws before any write and this reports `broken`.
//   * Every write happens inside that single interactive transaction and is
//     undone by the sentinel throw. Prisma rolls back a transaction whose
//     callback rejects; no row is committed, no orphan is left.
//   * The code calls NO controllers, so no notification, webhook, Pusher/realtime
//     broadcast, activity log, or email path is touched. The raw `tx.task.update`
//     and `tx.savedContent.create` writes have no out-of-band side effects.
//   * `SavedContent.id` is a UUID primary key, not a PostgreSQL `serial`, so a
//     rolled-back INSERT consumes no sequence value. The targeted `Task.id` is an
//     existing row (a plain UPDATE, also sequence-free). No sequence gap is burned.
//   * The probe board and probe task belong to the caller, so no data outside the
//     caller's own account is ever read, locked, or written. Ownership is checked
//     again inside the transaction, so a fixture that changes hands mid-probe is
//     never written to.

export type TaskWriteProbeLock = <T>(
  taskId: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>

export interface TaskWriteProbeDeps {
  /**
   * Test seam only. Production (and the `/api/ops/task-write-probe` route) uses
   * the real `withTaskStarWriteLock` from writeLocks.ts. Tests inject a broken
   * real-SQL lock to reproduce PR #2789 and prove the probe reports `broken`.
   */
  lock?: TaskWriteProbeLock
  /**
   * Test seam only. Production uses the real `prisma.savedContent.findUnique`
   * read to confirm the throwaway row did not survive the rollback. Tests inject
   * a throwing function to prove a verification read failure is never reported
   * as `healthy`.
   */
  verifyRollback?: (probeRowId: string) => Promise<{ id: string } | null>
}

export type TaskWriteProbeResult =
  | { status: 'healthy'; rolledBack: true; lockedTaskId: number; probeRowId: string }
  | { status: 'inconclusive'; reason: string }
  // The gate cannot run at all until an operator provisions the fixture. Distinct
  // from inconclusive so a never-provisioned identity fails the health job loudly
  // instead of warning forever, and distinct from broken so it never rolls a
  // deployment back over a setup problem a rollback cannot fix.
  | { status: 'misconfigured'; reason: string }
  | { status: 'broken'; error: string }

// A distinctive marker so the sentinel is recognisable even if a driver wraps
// the original error (Prisma preserves the thrown object, but matching by
// message too costs nothing and makes the healthy/broken decision robust).
const PROBE_ROLLBACK_MARKER = 'HTPR-5467 task-write probe rollback (intentional)'

class ProbeRollback extends Error {
  constructor() {
    super(PROBE_ROLLBACK_MARKER)
    this.name = 'TaskWriteProbeRollback'
  }
}

function isProbeRollback(err: unknown): boolean {
  if (err instanceof ProbeRollback) return true
  const message = err instanceof Error ? err.message : String(err ?? '')
  return message.includes(PROBE_ROLLBACK_MARKER)
}

// The probe target stopped matching its ownership predicates mid-transaction.
// That is a fixture problem, not evidence the write path is broken, so it must
// report inconclusive and never roll a deployment back.
class ProbeTargetGone extends Error {
  constructor() {
    super('probe fixture changed while the probe was running')
    this.name = 'TaskWriteProbeTargetGone'
  }
}

// Stable markers so the probe finds the row it created last time instead of
// making a new one every run. `Project.name` is globally unique, so the userId
// suffix keeps one board per health identity.
export const PROBE_TASK_TITLE = 'Task-write health probe (HTPR-5467) — do not delete'
export const probeProjectName = (userId: number) => `ht-task-write-probe-u${userId}`

// Names the exact identity the bearer token resolved to, so nobody has to guess
// which account to provision (or provisions the wrong one and stays broken).
const fixtureMissing = (userId: number) =>
  `probe fixture missing; run \`node scripts/ensure-task-write-probe-fixture.mjs ${userId}\` against production`

/** Every predicate the probe target must satisfy, in one place so the pre-transaction
 * lookup and the in-transaction re-read cannot drift apart. Ownership is checked on
 * the task AND its board: a board transferred to another account must stop matching. */
const probeTaskWhere = (userId: number) => ({
  userId,
  title: PROBE_TASK_TITLE,
  // Archive exactly, not merely "not Deleted": the probe may only ever write to
  // the reserved fixture, never to an ordinary user-visible task that happens to
  // share the name. The board's lifecycle is part of that contract too.
  status: 'Archive' as const,
  project: {
    name: probeProjectName(userId),
    ownerId: userId,
    status: 'Archive' as const,
  },
})

/**
 * The caller's own probe fixture. Read-only: the health endpoint never creates
 * anything, so a production deploy cannot silently mint user-visible records.
 * `ensureTaskWriteProbeFixture` (via scripts/ensure-task-write-probe-fixture.mjs)
 * is the one deliberate place those two rows are committed.
 *
 * An absent fixture is `misconfigured` (nobody has provisioned it yet). A failing
 * lookup is `broken`: not being able to read the Task table at all is a real
 * failure of the path this probe exists to prove, and must not pass as a warning.
 */
async function resolveProbeTask(
  userId: number,
): Promise<{ id: number } | { status: 'misconfigured' | 'broken'; message: string }> {
  try {
    const existing = await prisma.task.findFirst({
      select: { id: true },
      where: probeTaskWhere(userId),
      orderBy: { id: 'asc' },
    })
    return existing ?? { status: 'misconfigured', message: fixtureMissing(userId) }
  } catch (err) {
    console.error('[task-write-probe] fixture lookup failed', err)
    return { status: 'broken', message: 'probe fixture lookup failed' }
  }
}

/**
 * Create the probe board + probe task for a health identity. Deliberate,
 * idempotent, and never called from the health endpoint — run it once per
 * identity from scripts/ensure-task-write-probe-fixture.mjs.
 *
 * The board is archived so it stays out of normal views. Deleting the task makes
 * the probe report misconfigured until this is run again, which restores it.
 */
export async function ensureTaskWriteProbeFixture(userId: number): Promise<{ id: number }> {
  const name = probeProjectName(userId)
  // One transaction, so a failure partway cannot leave an orphan board behind and
  // two racing bootstraps cannot both create a task: `@@unique([projectId,
  // uniqueIndex])` makes the loser roll back whole.
  return prisma.$transaction(async (tx) => {
    // `Project.name` is globally unique, so the upsert can hand back a board owned
    // by somebody else if that name were ever taken. Writing into it is exactly the
    // cross-tenant reach this probe must not have.
    const project = await tx.project.upsert({
      where: { name },
      update: {},
      create: { name, title: 'Task-write health probe', ownerId: userId, status: 'Archive' },
      select: { id: true, ownerId: true, status: true },
    })
    if (project.ownerId !== userId) {
      throw new Error(`probe board ${name} is owned by another account`)
    }
    // Restore a soft-deleted fixture, but never adopt a live user-visible board:
    // reserved-name collisions fail closed rather than silently archiving
    // somebody's real work.
    if (project.status === 'Deleted') {
      await tx.project.update({ where: { id: project.id }, data: { status: 'Archive' } })
    } else if (project.status !== 'Archive') {
      throw new Error(`board ${name} exists as a live board and is not the reserved fixture`)
    }

    // Status-blind on purpose: the probe ignores a soft-deleted fixture, but
    // provisioning has to find it to restore it. `@@unique([projectId,
    // uniqueIndex])` means creating a replacement alongside it fails forever.
    const existing = await tx.task.findFirst({
      select: { id: true, status: true },
      where: { userId, title: PROBE_TASK_TITLE, projectId: project.id },
      orderBy: { id: 'asc' },
    })
    if (existing) {
      if (existing.status === 'Deleted') {
        await tx.task.update({
          where: { id: existing.id },
          data: { status: 'Archive', deletedAt: null, permanentlyDeleteAt: null },
        })
      } else if (existing.status !== 'Archive') {
        throw new Error('the probe task exists as a live task and is not the reserved fixture')
      }
      return { id: existing.id }
    }

    return tx.task.create({
      data: {
        uniqueIndex: 1,
        section: 'Todo',
        title: PROBE_TASK_TITLE,
        description: 'Written and rolled back by the production task-write health check.',
        projectId: project.id,
        userId,
        status: 'Archive',
      },
      select: { id: true },
    })
  })
}

/**
 * Exercise the real task-write lock + write path against the real database and
 * roll everything back.
 *
 * Runs against the authenticated caller's own dedicated probe task, so no other
 * tenant's data is read, locked, or written.
 *
 * Outcomes:
 *   - healthy:       lock acquired, writes applied inside the transaction, and
 *                    the transaction rolled back (throwaway row absent after).
 *   - broken:        the lock helper or a write threw a non-sentinel error, or the
 *                    fixture lookup itself failed.
 *   - misconfigured: no fixture has been provisioned for this identity yet.
 *   - inconclusive:  the run could not prove the write path (fixture changed
 *                    mid-probe, verification read failed). NEVER healthy.
 */
export async function runTaskWriteProbe(
  userId: number,
  deps: TaskWriteProbeDeps = {},
): Promise<TaskWriteProbeResult> {
  const lock = deps.lock ?? (withTaskStarWriteLock as TaskWriteProbeLock)
  const verifyRollback =
    deps.verifyRollback ??
    ((probeRowId: string) =>
      prisma.savedContent.findUnique({ where: { id: probeRowId } }))

  const target = await resolveProbeTask(userId)
  if ('status' in target) {
    return target.status === 'broken'
      ? { status: 'broken', error: target.message }
      : { status: 'misconfigured', reason: target.message }
  }

  // Unique id for the throwaway row; never persisted after rollback.
  const probeRowId = randomUUID()

  try {
    await lock(target.id, async (tx) => {
      // Re-read inside the transaction under the SAME ownership predicates, so a
      // task deleted, reassigned, or moved to a board that changed hands between
      // the read above and this transaction can never be written to.
      const current = await tx.task.findFirst({
        where: { id: target.id, ...probeTaskWhere(userId) },
        select: { id: true, userId: true, projectId: true },
      })
      if (!current) {
        throw new ProbeTargetGone()
      }

      // Real write through the same Task model the app uses. `updatedAt` is a
      // plain nullable column (no @updatedAt trigger), so this is a genuine
      // row-level UPDATE and nothing fires off the back of it.
      //
      // updateMany, not update: the ownership predicates ride along INTO the
      // UPDATE's WHERE clause, so the check and the write are one statement. A
      // reassignment landing between the read above and this line updates zero
      // rows instead of writing to a task that just changed hands.
      const written = await tx.task.updateMany({
        where: { id: current.id, ...probeTaskWhere(userId) },
        data: { updatedAt: new Date() },
      })
      if (written.count !== 1) {
        throw new ProbeTargetGone()
      }

      // Real INSERT on the same table the star path writes. UUID primary key —
      // no sequence consumed. No controller wrapping = no side effects.
      //
      // `SavedContent` declares only `@@index([taskId, userId, commentId])` and
      // `@@index([commentId, taskId, userId, type])` — no `@@unique` anywhere —
      // so a duplicate (userId, taskId, commentId) tuple is legal and this
      // INSERT cannot collide with an existing row.
      await tx.savedContent.create({
        data: {
          id: probeRowId,
          userId: current.userId,
          taskId: current.id,
          projectId: current.projectId,
          commentId: null,
          type: 'Private',
        },
      })

      // Prove both writes became visible inside the transaction before rollback.
      const seen = await tx.savedContent.findUnique({ where: { id: probeRowId } })
      if (!seen) {
        throw new Error('probe write did not become visible inside the transaction')
      }

      // Force Prisma to ROLL BACK everything above (including the transaction-
      // scoped advisory lock, which is released at rollback/commit).
      throw new ProbeRollback()
    })
  } catch (err) {
    if (isProbeRollback(err)) {
      // Belt-and-braces: confirm the throwaway row did not survive the rollback.
      //
      // The verification read must NOT be swallowed. A failure here means we
      // cannot PROVE the rollback happened, so reporting `healthy` would be a
      // false green (the exact failure class HTPR-5467 exists to remove).
      //
      // It is also deliberately NOT `broken`: `broken` is the workflow's signal
      // to roll the deployment back, and a verification read failure is not
      // evidence that the write/lock path is broken — the writes above already
      // succeeded against the same database moments earlier, and rolling the app
      // back would not fix a transient read outage or DB timeout. So we choose
      // `inconclusive`: never healthy, never rolls back — the workflow warns and
      // asks a human to verify the write path instead.
      let leftover
      try {
        leftover = await verifyRollback(probeRowId)
      } catch (verifyErr) {
        // Details stay in the server log: this endpoint answers any authenticated
        // caller, and Prisma messages carry table, constraint, and SQL diagnostics.
        console.error('[task-write-probe] post-rollback verification failed', verifyErr)
        return { status: 'inconclusive', reason: 'post-rollback verification query failed' }
      }
      if (leftover) {
        // A committed probe is a broken probe. Clean up our own row best-effort
        // so we never leave an orphan behind even in a rollback failure.
        await prisma.savedContent
          .deleteMany({ where: { id: probeRowId } })
          .catch(() => {})
        return {
          status: 'broken',
          error: 'probe rollback failed: throwaway row persisted',
        }
      }
      return {
        status: 'healthy',
        rolledBack: true,
        lockedTaskId: target.id,
        probeRowId,
      }
    }
    if (err instanceof ProbeTargetGone) {
      return { status: 'inconclusive', reason: err.message }
    }
    // Same reasoning as the verification read: the operator gets the details from
    // the server log, the caller gets a fixed string.
    console.error('[task-write-probe] task-write path failed', err)
    return { status: 'broken', error: 'task-write probe failed' }
  }

  // Unreachable with the real helper (the operation always throws the sentinel),
  // but if an injected lock swallows the throw we must never report healthy.
  return { status: 'broken', error: 'probe completed without rolling back' }
}