import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import prisma from '@/lib/prisma'
import { getRedis } from '@/lib/redis'
import { aiFeedbackEnabled } from './enabled'
import { PriorityConstants } from '@/lib/constants/constants'
import { escapeHtml } from '@/utils/htmlEscape'
import { createTaskCore } from '@/utils/controllers/tasks/createTaskCore'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { updateCommentService } from '@/utils/controllers/comments/updateCommentService'
import { broadcastTaskChange } from '@/lib/realtime/server'
import { aiFeedbackSchema, feedbackFingerprint, scrubFeedbackText, type AiFeedbackInput } from './input'
import { reserveFeedbackAttempt, reserveFeedbackQuota } from './rateLimit'

export { aiFeedbackEnabled } from './enabled'

const PROJECT_ID = 15
const MAX_REPORTERS = 10

const RETRY_KEY = 'ai-feedback:retry'
const COUNT_TTL = 30 * 86400

export const FEEDBACK_RENEW_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], 30000)
end
return 0
`

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

function description(input: AiFeedbackInput, fingerprint: string, count: number, displayName?: string) {
  const rows = [
    ['Surface', input.surface], ['Tool', input.tool], ['HTTP status', input.status],
    ['Error code', input.errorCode], ['Category', input.category ?? 'other'],
  ].filter(([, value]) => value !== undefined && value !== '')
  return rows.map(([label, value]) => `<p>${label}: ${escapeHtml(String(value))}</p>`).join('') +
    (input.note !== undefined || input.error !== undefined ? '<p>Free text was supplied and not stored, for privacy.</p>' : '') +
    `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p><p>Seen ${count} times</p><p>Last seen: ${new Date().toISOString()}</p>` +
    reporterLine('Reporting display names', displayName ? [displayName] : []) +
    reporterLine('Clients', input.client ? [input.client] : [])
}

async function enqueueRetry(input: AiFeedbackInput, userId?: number) {
  const { note: _note, error: _error, ...structured } = aiFeedbackSchema.parse(input)
  const redis = await getRedis()
  const results = await redis.multi()
    .rpush(RETRY_KEY, JSON.stringify({ input: structured, userId }))
    .ltrim(RETRY_KEY, -500, -1)
    .expire(RETRY_KEY, 86400)
    .exec()
  const failure = results?.find(([error]) => error)?.[0]
  if (failure) throw failure
}

async function drainRetries() {
  const redis = await getRedis()
  // Pop the batch first so a failed entry is retried only once per call.
  const entries = await redis.lpop(RETRY_KEY, 5)
  for (const entry of entries ?? []) {
    const { input, userId } = JSON.parse(entry) as { input: AiFeedbackInput; userId?: number }
    try {
      await fileReport(input, userId, true)
    } catch {
      await enqueueRetry(input, userId)
    }
  }
}

export async function fileAiFeedback(raw: unknown, userId?: number, automatic = false) {
  await drainRetries()
  return fileReport(raw, userId, automatic, true)
}

async function fileReport(raw: unknown, userId?: number, automatic = false, queueOnContention = false) {
  if (!await reserveFeedbackAttempt(userId)) throw new AiFeedbackError(429, 'AI feedback hourly attempt limit reached')
  if (!await aiFeedbackEnabled(userId)) throw new AiFeedbackError(404, 'Not found')
  const parsed = aiFeedbackSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiFeedbackError(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const input = { ...parsed.data, client: parsed.data.client?.toLowerCase() }
  const fingerprint = feedbackFingerprint(input)
  const marker = `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p>`
  const redis = await getRedis()
  const countKey = `ai-feedback:count:${fingerprint}`
  const lockKey = `ai-feedback:lock:${fingerprint}`
  const lockToken = randomUUID()
  if (await redis.set(lockKey, lockToken, 'EX', 30, 'NX') !== 'OK') {
    if (automatic) {
      if (queueOnContention) await enqueueRetry(input, userId)
      throw new AiFeedbackError(503, 'Feedback is busy, try again shortly')
    }
    for (let attempt = 0; ; attempt++) {
      await setTimeout(250)
      if (await redis.set(lockKey, lockToken, 'EX', 30, 'NX') === 'OK') break
      if (attempt === 18) throw new AiFeedbackError(503, 'Feedback is busy, try again shortly')
    }
  }
  let leaseLost = false
  const renewLease = async () => {
    try {
      if (Number(await redis.eval(FEEDBACK_RENEW_LEASE_SCRIPT, 1, lockKey, lockToken)) !== 1) leaseLost = true
    } catch {
      leaseLost = true
    }
  }
  const checkLease = async () => {
    if (!leaseLost) await renewLease()
    if (leaseLost) throw new AiFeedbackError(503, 'Feedback lease lost, try again shortly')
  }
  const renewal = setInterval(() => { void renewLease() }, 10_000)
  renewal.unref()
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
      select: { id: true, userId: true, ticketNumber: true, uniqueIndex: true, description_: { select: { content: true } } },
    })
    const actorId = existing?.userId ?? project.ownerId
    const tallyMarker = `<p>AI feedback tally: ai-fb-${fingerprint.slice(0, 12)}</p>`
    const comment = existing ? await prisma.comment.findFirst({
      where: { taskId: existing.id, creatorId: actorId, agentId: null, text: { contains: tallyMarker } },
      orderBy: { id: 'asc' }, select: { id: true, text: true },
    }) : null
    await checkLease()
    if (!await reserveFeedbackQuota(userId, Boolean(existing))) throw new AiFeedbackError(429, 'AI feedback hourly limit reached')
    const storedCount = Number(comment?.text.match(/<p>Seen (\d+) times<\/p>/)?.[1] ?? 1)
    await checkLease()
    if (existing) await redis.set(countKey, storedCount, 'EX', COUNT_TTL, 'NX')
    else await redis.set(countKey, 0, 'EX', COUNT_TTL)
    await checkLease()
    const count = await redis.incr(countKey)
    await checkLease()
    await redis.expire(countKey, COUNT_TTL)
    if (existing) {
      const text = tallyComment(comment?.text ?? existing.description_?.content ?? '', tallyMarker, count, displayName, input.client)
      await checkLease()
      if (comment) {
        await updateCommentService({ commentId: comment.id, text, userId: actorId })
      } else {
        await createCommentService({
          taskId: existing.id, text, creatorId: actorId, ownerId: existing.userId,
          currentUser: { id: actorId }, processTaskReferences: false,
        })
      }
      await checkLease()
      void broadcastTaskChange(existing.id).catch(() => {})
      return receipt(existing, true, count, project.uniqueIdentifier)
    }
    let label = await prisma.label.findFirst({ where: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
    if (!label) {
      try {
        await checkLease()
        label = await prisma.label.create({ data: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
      } catch (error) {
        label = await prisma.label.findFirst({ where: { projectId: PROJECT_ID, value: 'ai-feedback' }, select: { id: true } })
        if (!label) throw error
      }
    }
    await checkLease()
    const { task } = await createTaskCore({
      title: `AI feedback: ${input.surface} ${input.tool ?? input.errorCode ?? input.status ?? 'unexpected-result'}`.slice(0, 80),
      description: description(input, fingerprint, count, displayName),
      userId: actorId, projectId: PROJECT_ID, sectionId: section.id, sectionTitle: section.section_title,
      projectIdentifier: project.uniqueIdentifier, createDrafts: false, labelIds: [label.id],
      priorityIndex: PriorityConstants.find((priority) => priority.Priority_Value === 'Medium')!.priority_index,
    })
    return receipt(task, false, count, project.uniqueIdentifier)
  } finally {
    clearInterval(renewal)
    await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, lockKey, lockToken).catch(() => {})
  }
}

function receipt(task: { ticketNumber: string | null; uniqueIndex: number }, deduped: boolean, count: number, projectIdentifier: string) {
  return { success: true as const, ticketNumber: task.ticketNumber ?? `${projectIdentifier}-${task.uniqueIndex}`, url: `https://app.hypertask.ai/detail/project-15/${task.uniqueIndex}`, deduped, count }
}
