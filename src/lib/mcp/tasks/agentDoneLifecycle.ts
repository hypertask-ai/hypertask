import { columnRoleFor } from '@/lib/mcp/boards/columnRole'
import type { Prisma } from '@prisma/client'

export class AgentDoneLifecycleDeniedError extends Error {
  readonly status = 403
  readonly code = 'agent_done_lifecycle_denied'

  constructor(message = 'Authenticated agents cannot delete tasks in Done') {
    super(message)
    this.name = 'AgentDoneLifecycleDeniedError'
  }
}

type LeaveDoneOptions = { mayArchive?: boolean }

function isDenied(requestedStatus: unknown, options: LeaveDoneOptions): boolean {
  if (requestedStatus === 'Deleted') return true
  return requestedStatus === 'Archive' && !options.mayArchive
}

export async function assertAgentMayLeaveDone(
  tx: Prisma.TransactionClient,
  current: { sectionId: number | null; status: string },
  requestedStatus: unknown,
  agentId?: string | null,
  options: LeaveDoneOptions = {},
): Promise<void> {
  await assertAgentMayLeaveDoneForTasks(tx, [current], requestedStatus, agentId, options)
}

export async function assertAgentMayLeaveDoneForTasks(
  tx: Prisma.TransactionClient,
  tasks: Array<{ sectionId: number | null; status: string }>,
  requestedStatus: unknown,
  agentId?: string | null,
  options: LeaveDoneOptions = {},
): Promise<void> {
  if (!agentId) return
  if (!isDenied(requestedStatus, options)) return

  const candidates = tasks.filter(
    (task) =>
      requestedStatus !== task.status &&
      task.sectionId != null &&
      Number.isFinite(task.sectionId),
  )
  if (candidates.length === 0) return

  const sectionIds = [
    ...new Set(candidates.map((task) => task.sectionId as number)),
  ]
  const sections = await tx.section.findMany({
    where: { id: { in: sectionIds } },
    select: { id: true, section_title: true, isDone: true },
  })
  const doneSectionIds = new Set(
    sections
      .filter((section) => columnRoleFor(section) === 'done')
      .map((section) => section.id),
  )
  if (candidates.some((task) => doneSectionIds.has(task.sectionId as number))) {
    throw new AgentDoneLifecycleDeniedError()
  }
}
