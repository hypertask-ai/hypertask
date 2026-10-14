import prisma from '@/lib/prisma'
import { aiFeedbackEnabled } from './enabled'
import { PriorityConstants } from '@/lib/constants/constants'
import { escapeHtml } from '@/utils/htmlEscape'
import { createTaskCore } from '@/utils/controllers/tasks/createTaskCore'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { broadcastTaskChange } from '@/lib/realtime/server'
import { aiFeedbackSchema, feedbackFingerprint, scrubFeedbackText, type AiFeedbackInput } from './input'
import { reserveFeedbackAttempt, reserveFeedbackQuota } from './rateLimit'

export { aiFeedbackEnabled } from './enabled'

const PROJECT_ID = 15
const MAX_REPORTERS = 10

export class AiFeedbackError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function reporterLine(label: string, values: string[]): string {
  return `<p>${label}: ${values.map(escapeHtml).join(', ')}</p>`
}

function reportingNames(content: string, label: string, value?: string): string[] {
  const stored = content.match(new RegExp(`<p>${label}: ([^<]*)</p>`))?.[1] ?? ''
  const decoded = stored.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const values = [...decoded.split(', '), ...(value ? [value] : [])].map((item) => {
    if (label === 'Clients') {
      const client = aiFeedbackSchema.shape.client.safeParse(item)
      return client.success ? client.data?.toLowerCase() : undefined
    }
    return scrubFeedbackText(item).replace(/,/g, ' ').slice(0, 60)
  }).filter((item): item is string => Boolean(item))
  return [...new Set(values)].slice(0, MAX_REPORTERS)
}

function tallyComment(content: string, marker: string, count: number, displayName?: string, client?: string) {
  return marker + `<p>Seen ${count} times</p><p>Last seen: ${new Date().toISOString()}</p>` +
    reporterLine('Reporting display names', reportingNames(content, 'Reporting display names', displayName)) +
    reporterLine('Clients', reportingNames(content, 'Clients', client))
}

function description(input: AiFeedbackInput, fingerprint: string, displayName?: string) {
  const rows = [
    ['Surface', input.surface], ['Tool', input.tool], ['HTTP status', input.status],
    ['Error code', input.errorCode], ['Category', input.category ?? 'other'],
  ].filter(([, value]) => value !== undefined && value !== '')
  return rows.map(([label, value]) => `<p>${label}: ${escapeHtml(String(value))}</p>`).join('') +
    (input.note !== undefined || input.error !== undefined ? '<p>Free text was supplied and not stored, for privacy.</p>' : '') +
    `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p><p>Last seen: ${new Date().toISOString()}</p>` +
    reporterLine('Reporting display names', displayName ? [displayName] : []) +
    reporterLine('Clients', input.client ? [input.client] : [])
}

export async function fileAiFeedback(raw: unknown, userId?: number) {
  if (!await aiFeedbackEnabled(userId)) throw new AiFeedbackError(404, 'Not found')
  const parsed = aiFeedbackSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiFeedbackError(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  if (!await reserveFeedbackAttempt(userId)) throw new AiFeedbackError(429, 'AI feedback hourly attempt limit reached')
  const reporterId = userId ?? Number(process.env.AI_FEEDBACK_AGENT_USER_ID)
  if (!Number.isSafeInteger(reporterId) || reporterId <= 0) return
  const input = { ...parsed.data, client: parsed.data.client?.toLowerCase() }
  const fingerprint = feedbackFingerprint(input)
  const marker = `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p>`
  const doneSections = await prisma.section.findMany({ where: { projectId: PROJECT_ID, OR: [{ isDone: true }, { section_title: { equals: 'Done', mode: 'insensitive' } }] }, select: { id: true, section_title: true } })
  const where = {
    projectId: PROJECT_ID, status: 'Normal' as const,
    AND: [
      { OR: [{ sectionId: null }, { sectionId: { notIn: doneSections.map((item) => item.id) } }] },
      { section: { notIn: doneSections.map((item) => item.section_title) } },
    ],
    description_: { is: { content: { contains: marker } } },
  }
  const deduped = Boolean(await prisma.task.findFirst({ where, select: { id: true } }))
  if (!await reserveFeedbackQuota(userId, deduped)) throw new AiFeedbackError(429, 'AI feedback hourly limit reached')
  const key = BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`))
  let changedTaskId: number | undefined
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`
      // Core services use global prisma, but this connection holds the lock throughout their work.
      const [project, user] = await Promise.all([
        // Feedback submitters need not be members of the internal product board.
        prisma.project.findFirst({
          where: { id: PROJECT_ID, status: 'Normal' },
          select: { uniqueIdentifier: true, section: {
            where: { deleted: false, visibility: true, section_title: 'Bugs' },
            take: 1, select: { id: true, section_title: true },
          } },
        }),
        userId === undefined ? null : prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
      ])
      const section = project?.section[0]
      if (!project?.uniqueIdentifier || !section) throw new AiFeedbackError(503, 'Feedback destination is not configured')
      const displayName = scrubFeedbackText(user?.displayName ?? '').replace(/,/g, ' ').slice(0, 60) || undefined
      const existing = await tx.task.findFirst({
        where, select: { id: true, userId: true, ticketNumber: true, uniqueIndex: true },
      })
      if (userId !== undefined && Boolean(existing) !== deduped && !await reserveFeedbackQuota(userId, Boolean(existing))) {
        throw new AiFeedbackError(429, 'AI feedback hourly limit reached')
      }
      const actorId = existing?.userId ?? reporterId
      const tallyMarker = `<p>AI feedback tally: ai-fb-${fingerprint.slice(0, 12)}</p>`
      const comment = existing ? await tx.comment.findFirst({
        where: { taskId: existing.id, creatorId: actorId, agentId: null, text: { contains: tallyMarker } },
        orderBy: { id: 'asc' }, select: { id: true, text: true },
      }) : null
      const storedCount = Number(comment?.text.match(/<p>Seen (\d+) times<\/p>/)?.[1] ?? 1)
      if (existing) {
        const count = storedCount + 1
        const text = tallyComment(comment?.text ?? '', tallyMarker, count, displayName, input.client)
        if (comment) {
          await tx.comment.update({ where: { id: comment.id }, data: { text, summary: null } })
        } else {
          await createCommentService({
            taskId: existing.id, text, creatorId: actorId, ownerId: existing.userId,
            currentUser: { id: actorId }, processTaskReferences: false, trustedCaller: true,
          })
        }
        changedTaskId = existing.id
        return receipt(existing, true, count, project.uniqueIdentifier)
      }
      let label = await prisma.label.findFirst({ where: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
      if (!label) {
        try {
          label = await prisma.label.create({ data: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
        } catch (error) {
          label = await prisma.label.findFirst({ where: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
          if (!label) throw error
        }
      }
      const count = 1
      const { task } = await createTaskCore({
        title: `AI feedback: ${input.surface} ${input.tool ?? input.errorCode ?? input.status ?? 'unexpected-result'}`.slice(0, 80),
        description: description(input, fingerprint, displayName),
        userId: actorId, projectId: PROJECT_ID, sectionId: section.id, sectionTitle: section.section_title,
        projectIdentifier: project.uniqueIdentifier, createDrafts: false, labelIds: [label.id],
        priorityIndex: PriorityConstants.find((priority) => priority.Priority_Value === 'Medium')!.priority_index,
      })
      await createCommentService({
        taskId: task.id, text: tallyComment('', tallyMarker, count, displayName, input.client),
        creatorId: actorId, ownerId: actorId, currentUser: { id: actorId },
        processTaskReferences: false, trustedCaller: true,
      })
      return receipt(task, false, count, project.uniqueIdentifier)
    }, { timeout: 30000, maxWait: 30000 })
    if (changedTaskId !== undefined) void broadcastTaskChange(changedTaskId).catch(() => {})
    return result
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2028') {
      throw new AiFeedbackError(503, 'Feedback timed out, try again shortly')
    }
    throw error
  }
}

function receipt(task: { ticketNumber: string | null; uniqueIndex: number }, deduped: boolean, count: number, projectIdentifier: string) {
  return { success: true as const, ticketNumber: task.ticketNumber ?? `${projectIdentifier}-${task.uniqueIndex}`, url: `https://app.hypertask.ai/detail/project-15/${task.uniqueIndex}`, deduped, count }
}
