import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import { recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { withTaskStarWriteLock } from './writeLocks'


export type TaskWriteProbeLock = <T>(
  taskId: number,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>

export interface TaskWriteProbeDeps {
  teamScope?: AgentTokenTeamScope | null
  agentId?: string | null
  lock?: TaskWriteProbeLock
  verifyRollback?: (probeRowId: string) => Promise<{ id: string } | null>
}

export type TaskWriteProbeResult =
  | { status: 'healthy'; rolledBack: true; lockedTaskId: number; probeRowId: string }
  | { status: 'inconclusive'; reason: string }
  | { status: 'misconfigured'; reason: string }
  | { status: 'broken'; error: string }

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

class ProbeTargetGone extends Error {
  constructor() {
    super('probe fixture changed while the probe was running')
    this.name = 'TaskWriteProbeTargetGone'
  }
}

export const PROBE_TASK_TITLE = 'Task-write health probe (HTPR-5467) — do not delete'
export const probeProjectName = (userId: number) => `ht-task-write-probe-u${userId}`

const fixtureMissing = (userId: number) =>
  `probe fixture missing; run \`node scripts/ensure-task-write-probe-fixture.mjs ${userId}\` against production`

const probeTaskWhere = (userId: number, agentId?: string | null, teamScope?: AgentTokenTeamScope | null) => ({
  userId,
  title: PROBE_TASK_TITLE,
  status: 'Archive' as const,
  project: {
    ...projectContentAccessWhere(userId, agentId, teamScope),
    name: probeProjectName(userId),
    ownerId: userId,
    status: 'Archive' as const,
  },
})

async function resolveProbeTask(
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Promise<{ id: number; projectId: number } | { status: 'misconfigured' | 'broken'; message: string }> {
  try {
    const existing = await prisma.task.findFirst({
      select: { id: true, projectId: true },
      where: probeTaskWhere(userId, agentId, teamScope),
      orderBy: { id: 'asc' },
    })
    return existing ?? { status: 'misconfigured', message: fixtureMissing(userId) }
  } catch (err) {
    console.error('[task-write-probe] fixture lookup failed', err)
    return { status: 'broken', message: 'probe fixture lookup failed' }
  }
}

export async function ensureTaskWriteProbeFixture(userId: number): Promise<{ id: number }> {
  const name = probeProjectName(userId)
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.upsert({
      where: { name },
      update: {},
      create: { name, title: 'Task-write health probe', ownerId: userId, status: 'Archive' },
      select: { id: true, ownerId: true, status: true },
    })
    if (project.ownerId !== userId) {
      throw new Error(`probe board ${name} is owned by another account`)
    }
    if (project.status === 'Deleted') {
      await tx.project.update({ where: { id: project.id }, data: { status: 'Archive' } })
    } else if (project.status !== 'Archive') {
      throw new Error(`board ${name} exists as a live board and is not the reserved fixture`)
    }

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

export async function runTaskWriteProbe(
  userId: number,
  deps: TaskWriteProbeDeps = {},
): Promise<TaskWriteProbeResult> {
  const lock = deps.lock ?? (withTaskStarWriteLock as TaskWriteProbeLock)
  const verifyRollback =
    deps.verifyRollback ??
    ((probeRowId: string) =>
      prisma.savedContent.findUnique({ where: { id: probeRowId } }))

  const target = await resolveProbeTask(userId, deps.agentId, deps.teamScope)
  if ('status' in target) {
    return target.status === 'broken'
      ? { status: 'broken', error: target.message }
      : { status: 'misconfigured', reason: target.message }
  }

  if (deps.agentId) recordAgentBoardScopeMiss(target.projectId, "write")
  const probeRowId = randomUUID()

  try {
    await lock(target.id, async (tx) => {
      const current = await tx.task.findFirst({
        where: { id: target.id, ...probeTaskWhere(userId, deps.agentId, deps.teamScope) },
        select: { id: true, userId: true, projectId: true },
      })
      if (!current) {
        throw new ProbeTargetGone()
      }

      const written = await tx.task.updateMany({
        where: { id: current.id, ...probeTaskWhere(userId, deps.agentId, deps.teamScope) },
        data: { updatedAt: new Date() },
      })
      if (written.count !== 1) {
        throw new ProbeTargetGone()
      }

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

      const seen = await tx.savedContent.findUnique({ where: { id: probeRowId } })
      if (!seen) {
        throw new Error('probe write did not become visible inside the transaction')
      }

      throw new ProbeRollback()
    })
  } catch (err) {
    if (isProbeRollback(err)) {
      let leftover
      try {
        leftover = await verifyRollback(probeRowId)
      } catch (verifyErr) {
        console.error('[task-write-probe] post-rollback verification failed', verifyErr)
        return { status: 'inconclusive', reason: 'post-rollback verification query failed' }
      }
      if (leftover) {
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
    console.error('[task-write-probe] task-write path failed', err)
    return { status: 'broken', error: 'task-write probe failed' }
  }

  return { status: 'broken', error: 'probe completed without rolling back' }
}