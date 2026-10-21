import prisma from '@/lib/prisma'
import { aiFeedbackEnabled } from './enabled'
import { HTPR_7536_PLAIN_AI_FEEDBACK_FLAG } from '@/lib/flags/definitions/htpr-7536-plain-ai-feedback'
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

function scopeRefusal(input: AiFeedbackInput): boolean {
  return [401, 403, 404].includes(input.status ?? 0) ||
    ['unauthorized', 'forbidden', 'not_found'].includes(input.errorCode?.toLowerCase() ?? '') || input.category === 'auth_failed'
}

export function plainFeedback(input: AiFeedbackInput, fingerprint: string, reporter?: { agentName?: string; ownerName?: string }) {
  const surface = { mcp: 'MCP', cli: 'CLI', api: 'API', agent: 'agent connection' }[input.surface]
  const call = `An agent's ${surface} call${input.tool && input.tool !== input.surface ? ` to ${input.tool}` : ''}`
  const noDetails = !input.tool && input.status === undefined && !input.errorCode && !input.error && !input.note
  let happened: string
  let reading: string
  let action: string
  if (scopeRefusal(input)) {
    const signIn = input.status === 401 || input.errorCode?.toLowerCase() === 'unauthorized' || input.category === 'auth_failed'
    happened = signIn ? `An agent was refused when it signed in through ${surface}` : `${call} was refused because the agent may not use that board or action`
    reading = signIn ? 'This usually means the agent used a wrong or expired key, not a Hypertask bug.' : 'The agent may have used a board or action it is not allowed to use; this is usually not a Hypertask bug.'
    action = "Tell the agent's owner to check its key and board permissions."
  } else if (input.status !== undefined && input.status >= 500) {
    happened = `${call} failed because Hypertask returned a server error`
    reading = 'This is likely a Hypertask bug.'
    action = 'An engineer should look.'
  } else {
    const failure = {
      call_failed: 'failed', empty_result: 'returned nothing', unexpected_result: 'returned an unexpected result',
      slow: 'was slow', user_reported_broken: 'was reported as broken', other: 'had a problem', auth_failed: 'was refused',
    }[input.category ?? 'other']
    happened = `${call} ${failure}${noDetails ? ' with no details' : ''}`
    reading = noDetails ? "There are no details, so we can't tell whether this is a Hypertask bug." : "The report alone does not show whether this is a Hypertask bug."
    action = noDetails ? 'Nothing for now; wait for a report with details.' : 'An engineer should look.'
  }
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date())
  const who = reporter?.agentName
    ? `${reporter.agentName}${reporter.ownerName ? `, owned by ${reporter.ownerName}` : ''}`
    : reporter?.ownerName ? `an agent owned by ${reporter.ownerName}` : 'unknown agent'
  return {
    title: `${happened} (${date})`,
    description: `<p><strong>What happened</strong>: ${escapeHtml(happened)}.</p>` +
      `<p><strong>Who hit it</strong>: ${escapeHtml(who)}.</p>` +
      `<p><strong>Is it a real bug?</strong> ${escapeHtml(reading)}</p>` +
      `<p><strong>What to do</strong>: ${escapeHtml(action)}</p>` +
      '<h2>Details for engineers</h2>' + description(input, fingerprint, reporter?.ownerName),
  }
}

export async function fileAiFeedback(raw: unknown, userId?: number, reporter?: { agentName?: string | null }) {
  if (!await aiFeedbackEnabled(userId)) throw new AiFeedbackError(404, 'Not found')
  const parsed = aiFeedbackSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AiFeedbackError(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  if (!await reserveFeedbackAttempt(userId)) throw new AiFeedbackError(429, 'AI feedback hourly attempt limit reached')
  const reporterId = userId ?? Number(process.env.AI_FEEDBACK_AGENT_USER_ID)
  if (!Number.isSafeInteger(reporterId) || reporterId <= 0) return
  const input = { ...parsed.data, client: parsed.data.client?.toLowerCase() }
  let plain = false
  try {
    const { featureFlagCandidateUserIds, isFeatureEnabled } = await import('@/lib/flags')
    plain = userId === undefined
      ? await featureFlagCandidateUserIds(HTPR_7536_PLAIN_AI_FEEDBACK_FLAG) === null
      : await isFeatureEnabled(HTPR_7536_PLAIN_AI_FEEDBACK_FLAG, userId)
  } catch {}
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
  const key = BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`))
  let changedTaskId: number | undefined
  const deadline = Date.now() + 30000
  try {
    while (Date.now() < deadline) {
      const result = await prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${key}) AS locked`
        if (!lock.locked) return
        const [project, user] = await Promise.all([
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
        if (plain && scopeRefusal(input) && !existing) {
          console.info('AI feedback not filed: normal access refusal', { surface: input.surface, fingerprint: `ai-fb-${fingerprint.slice(0, 12)}` })
          return { success: false as const, filed: false as const, reason: 'access_refused' as const, error: 'Normal access refusal; no new ticket was filed.' }
        }
        if (!await reserveFeedbackQuota(userId, Boolean(existing))) {
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
        const readable = plain ? plainFeedback(input, fingerprint, {
          agentName: scrubFeedbackText(reporter?.agentName ?? '').slice(0, 60) || undefined,
          ownerName: displayName,
        }) : undefined
        const { task } = await createTaskCore({
          creationChannel: "agent",
          title: readable?.title ?? `AI feedback: ${input.surface} ${input.tool ?? input.errorCode ?? input.status ?? 'unexpected-result'}`.slice(0, 80),
          description: readable?.description ?? description(input, fingerprint, displayName),
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
      }, { timeout: 30000, maxWait: Math.max(1, deadline - Date.now()) })
      if (result) {
        if (changedTaskId !== undefined) void broadcastTaskChange(changedTaskId).catch(() => {})
        return result
      }
      const remaining = deadline - Date.now()
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 100 + Math.floor(Math.random() * 151))))
    }
    throw new AiFeedbackError(503, 'Feedback timed out, try again shortly')
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
