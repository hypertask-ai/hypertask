import { columnRole, columnRoleFor } from '@/lib/mcp/boards/columnRole'
import type { Prisma } from '@prisma/client'

/**
 * Authenticated agents may not Archive or soft-Delete a task once it has
 * entered Done. Humans keep the final review and cleanup step.
 */
export class AgentDoneLifecycleDeniedError extends Error {
  readonly status = 403
  readonly code = 'agent_done_lifecycle_denied'

  constructor(
    message =
      'Authenticated agents cannot archive or delete tasks that have entered Done',
  ) {
    super(message)
    this.name = 'AgentDoneLifecycleDeniedError'
  }
}

type GuardedTask = {
  id: number
  projectId: number
  sectionId: number | null
  status: string
}

export async function assertAgentMayLeaveDone(
  tx: Prisma.TransactionClient,
  current: GuardedTask,
  requestedStatus: unknown,
  agentId?: string | null,
): Promise<void> {
  await assertAgentMayLeaveDoneForTasks(tx, [current], requestedStatus, agentId)
}

/**
 * Apply the Done lifecycle rule to every task a shared mutation will touch.
 * Section events preserve the rule after a task moves out of Done.
 */
export async function assertAgentMayLeaveDoneForTasks(
  tx: Prisma.TransactionClient,
  tasks: GuardedTask[],
  requestedStatus: unknown,
  agentId?: string | null,
): Promise<void> {
  if (!agentId) return
  if (requestedStatus !== 'Archive' && requestedStatus !== 'Deleted') return

  const candidates = tasks.filter(
    (task) =>
      requestedStatus !== task.status &&
      Number.isFinite(task.id) &&
      Number.isFinite(task.projectId),
  )
  if (candidates.length === 0) return

  const projectIds = [...new Set(candidates.map((task) => task.projectId))]
  const sections = await tx.section.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true, section_title: true, isDone: true },
  })
  const doneSectionIds = new Set<number>()
  const knownTitlesByProject = new Map<number, Set<string>>()
  const doneTitlesByProject = new Map<number, Set<string>>()
  for (const section of sections) {
    const title = section.section_title.trim().toLowerCase()
    const knownTitles =
      knownTitlesByProject.get(section.projectId) ?? new Set<string>()
    knownTitles.add(title)
    knownTitlesByProject.set(section.projectId, knownTitles)
    if (columnRoleFor(section) === 'done') {
      doneSectionIds.add(section.id)
      const doneTitles =
        doneTitlesByProject.get(section.projectId) ?? new Set<string>()
      doneTitles.add(title)
      doneTitlesByProject.set(section.projectId, doneTitles)
    }
  }
  if (
    candidates.some(
      (task) =>
        task.sectionId != null && doneSectionIds.has(task.sectionId),
    )
  ) {
    throw new AgentDoneLifecycleDeniedError()
  }

  const taskById = new Map(candidates.map((task) => [task.id, task]))

  const sectionEvents = await tx.taskSectionEvent.findMany({
    where: { taskId: { in: candidates.map((task) => task.id) } },
    select: { taskId: true, from: true, to: true },
  })
  const enteredDone = sectionEvents.some((event) => {
    const task = taskById.get(event.taskId)
    if (!task) return false
    const knownTitles = knownTitlesByProject.get(task.projectId)
    const doneTitles = doneTitlesByProject.get(task.projectId)
    return [event.from, event.to].some((title) => {
      const normalized = title.trim().toLowerCase()
      if (doneTitles?.has(normalized)) return true
      return !knownTitles?.has(normalized) && columnRole(title) === 'done'
    })
  })
  if (enteredDone) throw new AgentDoneLifecycleDeniedError()
}
