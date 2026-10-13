import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { aiFeedbackEnabled } from './enabled'
import { PriorityConstants } from '@/lib/constants/constants'
import { escapeHtml } from '@/utils/htmlEscape'
import { createTaskCore } from '@/utils/controllers/tasks/createTaskCore'
import upsertTaskDescription from '@/utils/controllers/description/common-description-create'
import { broadcastTaskChange } from '@/lib/realtime/server'
import { aiFeedbackSchema, feedbackFingerprint, scrubFeedbackText, type AiFeedbackInput } from './input'
import { reserveFeedbackQuota } from './rateLimit'

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

export function bumpFeedbackDescription(content: string, displayName?: string, client?: string, reportBody = '') {
  const previous = Number(content.match(/<p>Seen (\d+) times<\/p>/)?.[1] ?? 1)
  const count = Number.isSafeInteger(previous) && previous > 0 ? previous + 1 : 2
  const reporters = reportingNames(content, 'Reporting display names', displayName)
  const clients = reportingNames(content, 'Clients', client)
  const body = reportBody.replace(/<p>Seen \d+ times<\/p>|<p>Reporting display names: [^<]*<\/p>|<p>Clients: [^<]*<\/p>/g, '')
  return { count, description: `${body}<p>Seen ${count} times</p>${reporterLine('Reporting display names', reporters)}${reporterLine('Clients', clients)}` }
}

function description(input: AiFeedbackInput, fingerprint: string, displayName?: string) {
  const rows = [
    ['Surface', input.surface], ['Tool', input.tool], ['HTTP status', input.status],
    ['Error code', input.errorCode], ['Error', scrubFeedbackText(input.error ?? '')],
    ['Note', scrubFeedbackText(input.note ?? '')],
  ].filter(([, value]) => value !== undefined && value !== '')
  return rows.map(([label, value]) => `<p>${label}: ${escapeHtml(String(value))}</p>`).join('') +
    `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p><p>Seen 1 times</p>` +
    reporterLine('Reporting display names', displayName ? [displayName] : []) +
    reporterLine('Clients', input.client ? [input.client] : [])
}

export async function fileAiFeedback(raw: unknown, userId?: number) {
  if (!await aiFeedbackEnabled(userId)) throw new AiFeedbackError(404, 'Not found')
  const parsed = aiFeedbackSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiFeedbackError(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const input = { ...parsed.data, client: parsed.data.client?.toLowerCase() }
  const fingerprint = feedbackFingerprint(input)
  const marker = `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p>`
  const redis = await getRedis()
  // Serialize destination writes, including label creation and dedupe across accounts.
  const lockKey = 'ai-feedback:destination-lock'
  const lockToken = randomUUID()
  if (await redis.set(lockKey, lockToken, 'EX', 300, 'NX') !== 'OK') {
    throw new AiFeedbackError(503, 'Feedback is busy, try again shortly')
  }
  try {
    const [project, user, doneSections] = await Promise.all([
      // Feedback submitters need not be members of the internal product board.
      prisma.project.findFirst({
        where: { id: PROJECT_ID, status: 'Normal' },
        select: { ownerId: true, uniqueIdentifier: true, section: {
          where: { deleted: false, visibility: true, section_title: 'Bugs' },
          take: 1, select: { id: true, section_title: true },
        } },
      }),
      userId === undefined ? null : prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
      prisma.section.findMany({ where: { projectId: PROJECT_ID, OR: [{ isDone: true }, { section_title: { equals: 'Done', mode: 'insensitive' } }] }, select: { id: true, section_title: true } }),
    ])
    const section = project?.section[0]
    if (!project?.uniqueIdentifier || !section) throw new AiFeedbackError(503, 'Feedback destination is not configured')
    // Use a service-side actor for all tickets. Only the scrubbed display name is public.
    const actorId = project.ownerId
    const displayName = scrubFeedbackText(user?.displayName ?? '').replace(/,/g, ' ').slice(0, 60) || undefined
    const existing = await prisma.task.findFirst({
      where: {
        projectId: PROJECT_ID, status: 'Normal',
        AND: [
          { OR: [{ sectionId: null }, { sectionId: { notIn: doneSections.map((item) => item.id) } }] },
          { section: { notIn: doneSections.map((item) => item.section_title) } },
        ],
        description_: { is: { content: { contains: marker } } },
      },
      select: { id: true, ticketNumber: true, uniqueIndex: true, description_: { select: { content: true } } },
    })
    if (!await reserveFeedbackQuota(userId, Boolean(existing))) throw new AiFeedbackError(429, 'AI feedback hourly limit reached')
    if (existing) {
      const bump = bumpFeedbackDescription(existing.description_?.content ?? '', displayName, input.client, description(input, fingerprint))
      await upsertTaskDescription({ taskId: existing.id, creatorId: actorId, actingUserId: actorId, content: bump.description })
      void broadcastTaskChange(existing.id).catch(() => {})
      return receipt(existing, true, bump.count, project.uniqueIdentifier)
    }
    const label = await prisma.label.findFirst({ where: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } }) ??
      await prisma.label.create({ data: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
    const { task } = await createTaskCore({
      title: `AI feedback: ${input.surface} ${input.tool ?? input.errorCode ?? input.status ?? 'unexpected-result'}`.slice(0, 80),
      description: description(input, fingerprint, displayName),
      userId: actorId, projectId: PROJECT_ID, sectionId: section.id, sectionTitle: section.section_title,
      projectIdentifier: project.uniqueIdentifier, createDrafts: false, labelIds: [label.id],
      priorityIndex: PriorityConstants.find((priority) => priority.Priority_Value === 'Medium')!.priority_index,
    })
    return receipt(task, false, 1, project.uniqueIdentifier)
  } finally {
    await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, lockKey, lockToken).catch(() => {})
  }
}

function receipt(task: { ticketNumber: string | null; uniqueIndex: number }, deduped: boolean, count: number, projectIdentifier: string) {
  return { success: true as const, ticketNumber: task.ticketNumber ?? `${projectIdentifier}-${task.uniqueIndex}`, url: `https://app.hypertask.ai/detail/project-15/${task.uniqueIndex}`, deduped, count }
}
