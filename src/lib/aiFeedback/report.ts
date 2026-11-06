import prisma from '@/lib/prisma'
import { aiFeedbackEnabled } from './enabled'
import { HTPR_7536_PLAIN_AI_FEEDBACK_FLAG } from '@/lib/flags/definitions/htpr-7536-plain-ai-feedback'
import { HTPR_8797_FEEDBACK_HOUSE_PARTS_FLAG } from '@/lib/flags/definitions/htpr-8797-feedback-house-parts'
import { HTPR_8197_NO_EVIDENCE_FEEDBACK_FLAG } from '@/lib/flags/definitions/htpr-8197-no-evidence-feedback'
import { HTPR_8275_AGENT_FEEDBACK_NOTE_FLAG } from '@/lib/flags/definitions/htpr-8275-agent-feedback-note'
import { accountCategory } from '@/lib/telemetry/accountCategory'
import { PriorityConstants } from '@/lib/constants/constants'
import { escapeHtml } from '@/utils/htmlEscape'
import { createProvisionedTaskCore } from '@/utils/controllers/tasks/createTaskCore'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { broadcastTaskChange } from '@/lib/realtime/server'
import { aiFeedbackSchema, feedbackFingerprint, scrubFeedbackText, scrubFeedbackNote, automaticFeedbackSchema, type AiFeedbackInput, type AutomaticFeedbackInput } from './input'
import { reserveFeedbackAttempt, reserveFeedbackQuota } from './rateLimit'
import { filedRecently, quietFixableReports, quietInputRefusal } from './callerFixable'

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

export type StoredNote = { kind?: string; note?: string }

function description(input: AutomaticFeedbackInput, fingerprint: string, displayName?: string, stored?: StoredNote) {
  const rows = [
    ['Surface', input.surface], ['Tool', input.tool], ['HTTP status', input.status],
    ['Error code', input.errorCode], ['Field', input.field], ['Category', input.category ?? 'other'],
    ['Kind', stored?.kind],
  ].filter(([, value]) => value !== undefined && value !== '')
  return rows.map(([label, value]) => `<p>${label}: ${escapeHtml(String(value))}</p>`).join('') +
    (stored?.note ? `<p>Note: ${escapeHtml(stored.note)}</p>` : '') +
    (input.error !== undefined || (input.note !== undefined && !stored?.note) ? '<p>Free text was supplied and not stored, for privacy.</p>' : '') +
    `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p><p>Last seen: ${new Date().toISOString()}</p>` +
    reporterLine('Reporting display names', displayName ? [displayName] : []) +
    reporterLine('Clients', input.client ? [input.client] : [])
}

function membershipRefusal(input: AiFeedbackInput): boolean {
  const code = input.errorCode?.toLowerCase().replace(/[._-]+/g, ' ') ?? ''
  return /\bnot a member\b/i.test(code) || /\bnot a member of (?:this|that|the) (?:board|project|team)\b/i.test(input.error ?? '')
}

function scopeRefusal(input: AiFeedbackInput): boolean {
  const code = input.errorCode?.toLowerCase().replace(/[._-]+/g, ' ') ?? ''
  if (code === 'route not found' || code === 'not found' && /\/api\//i.test(input.error ?? '')) return false
  const refusal = `${code} ${input.error ?? ''}`
  if (membershipRefusal(input) && (input.status === undefined || [400, 401, 403, 404].includes(input.status))) return true
  if (![401, 403, 404].includes(input.status ?? 0)) return false
  return /\b(?:unauthorized|forbidden|(?:permission|access|scope) (?:denied|refused)|insufficient (?:permissions?|scope)|(?:invalid|expired|revoked) (?:token|key)|(?:token|key) (?:invalid|expired|revoked)|auth(?:entication)? failed|(?:task|board|project) not found)\b/i.test(refusal)
}

function toolOnlyFailure(input: AutomaticFeedbackInput): boolean {
  return input.category === 'call_failed' && input.tool !== undefined && input.status === undefined && !input.errorCode && !input.field
}

async function noEvidenceRefused(userId?: number): Promise<boolean> {
  try {
    const { featureFlagCandidateUserIds, isFeatureEnabled } = await import('@/lib/flags')
    return userId === undefined
      ? await featureFlagCandidateUserIds(HTPR_8197_NO_EVIDENCE_FEEDBACK_FLAG) === null
      : await isFeatureEnabled(HTPR_8197_NO_EVIDENCE_FEEDBACK_FLAG, userId)
  } catch {
    return false
  }
}

async function agentNoteAllowed(userId?: number): Promise<boolean> {
  if (userId === undefined) return false
  try {
    const { isFeatureEnabled } = await import('@/lib/flags')
    if (!await isFeatureEnabled(HTPR_8275_AGENT_FEEDBACK_NOTE_FLAG, userId)) return false
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    return user ? accountCategory(user) === 'internal' : false
  } catch {
    return false
  }
}

function shortNote(note: string): string {
  return note.length <= 64 ? note : `${note.slice(0, 61).replace(/\s\S*$/, '')}...`
}

function houseReading(reading: string) {
  if (reading.includes('wrong or expired key')) return 'This usually means a wrong or expired key.'
  if (reading.includes('may have used a board')) return 'The agent may not use that board or action.'
  if (reading.includes("can't tell")) return 'There are no details, so we cannot tell yet.'
  return reading
}

function houseSubject(input: AutomaticFeedbackInput, surface: string) {
  return input.surface === 'agent' ? 'An agent connection' : `An agent's ${surface} call`
}

function feedbackLogActivity(text: string) {
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return { type: 'AiFeedbackLog' as const, data: { text: plain } }
}

function withCommand(note: string, command?: string): string {
  const short = shortNote(note)
  return !command || short.toLowerCase().includes(command.toLowerCase()) ? short : `${short} (${command})`
}

export function plainFeedback(input: AutomaticFeedbackInput, fingerprint: string, reporter?: { agentName?: string; ownerName?: string; origin?: 'agent' | 'automatic' }, stored?: StoredNote, shape: 'plain' | 'house' = 'plain') {
  const surface = { mcp: 'MCP', cli: 'CLI', api: 'API', agent: 'agent connection' }[input.surface]
  const call = `An agent's ${surface} call${input.tool && input.tool !== input.surface ? ` to ${input.tool}` : ''}`
  const failureKind = input.category ?? 'other'
  const noDetails = (failureKind === 'call_failed' || failureKind === 'other') &&
    input.status === undefined && !input.errorCode && !input.error && !input.note
  let happened: string
  let problem: string
  let reading: string
  let action: string
  const subject = houseSubject(input, surface)
  if (reporter?.origin !== 'automatic' && scopeRefusal(input)) {
    const signIn = !membershipRefusal(input) && (input.status === 401 || input.errorCode?.toLowerCase() === 'unauthorized' || input.category === 'auth_failed')
    happened = signIn ? `An agent was refused when it signed in through ${surface}` : `${call} was refused because the agent may not use that board or action`
    problem = signIn ? happened : `${subject} was refused`
    reading = signIn ? 'This usually means the agent used a wrong or expired key, not a Hypertask bug.' : 'The agent may have used a board or action it is not allowed to use; this is usually not a Hypertask bug.'
    action = "Tell the agent's owner to check its key and board permissions."
  } else if (input.status !== undefined && input.status >= 500) {
    happened = `${call} failed because Hypertask returned a server error`
    problem = `${subject} failed on the server`
    reading = 'This is likely a Hypertask bug.'
    action = 'An engineer should look.'
  } else {
    const failure = {
      call_failed: 'failed', empty_result: 'returned nothing', unexpected_result: 'returned an unexpected result',
      slow: 'was slow', user_reported_broken: 'was reported as broken', other: 'had a problem', auth_failed: 'was refused',
    }[input.category ?? 'other']
    happened = `${call} ${failure}${noDetails ? ' with no details' : ''}`
    problem = `${subject} ${failure}${noDetails ? ' with no details' : ''}`
    reading = noDetails ? "There are no details, so we can't tell whether this is a Hypertask bug." : "The report alone does not show whether this is a Hypertask bug."
    action = noDetails ? 'Nothing for now; wait for a report with details.' : 'An engineer should look.'
  }
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date())
  const who = reporter?.agentName
    ? `${reporter.agentName}${reporter.ownerName ? `, owned by ${reporter.ownerName}` : ''}`
    : reporter?.ownerName ? `an agent owned by ${reporter.ownerName}` : 'unknown agent'
  const command = input.tool && input.tool !== input.surface ? input.tool : undefined
  const note = shortNote(stored?.note ?? happened)
  const title = stored?.kind ? `Agent feedback, ${stored.kind}: ${stored.kind === 'missing' ? withCommand(note, command) : note}` : `${happened} (${date})`
  if (shape !== 'house') {
    return {
      title,
      description: `<p><strong>What happened</strong>: ${escapeHtml(happened)}.</p>` +
        `<p><strong>Who hit it</strong>: ${escapeHtml(who)}.</p>` +
        `<p><strong>Is it a real bug?</strong> ${escapeHtml(reading)}</p>` +
        `<p><strong>What to do</strong>: ${escapeHtml(action)}</p>` +
        '<h2>Details for engineers</h2>' + description(input, fingerprint, reporter?.ownerName, stored),
    }
  }
  const kept = (stored?.kind ? `<p>Kind: ${escapeHtml(stored.kind)}</p>` : '') +
    (stored?.note ? `<p>Note: ${escapeHtml(stored.note)}</p>` : '') +
    (input.error !== undefined || (input.note !== undefined && !stored?.note) ? '<p>Free text was supplied and not stored, for privacy.</p>' : '')
  return {
    title,
    description: '<h2>Problem</h2>' +
      `<p>${escapeHtml(problem)}.</p>` +
      `<p><strong>Who hit it</strong>: ${escapeHtml(who)}.</p>` +
      `<p>${escapeHtml(houseReading(reading))}</p>` +
      kept +
      '<h2>Fix</h2>' +
      `<p>${escapeHtml(action)}</p>` +
      '<h2>Done when</h2>' +
      '<p>A repeat report joins this same ticket.</p>' +
      '<p>The description has no error code.</p>' +
      '<h2>Risk</h2>' +
      '<p>A repeat could open another ticket.</p>' +
      '<h2>Decision</h2>' +
      '<p>None.</p>',
  }
}

export async function fileAiFeedback(raw: unknown, userId?: number, reporter: { origin: 'agent' | 'automatic'; agentName?: string | null } = { origin: 'agent' }) {
  if (!await aiFeedbackEnabled(userId)) throw new AiFeedbackError(404, 'Not found')
  const parsed = (reporter.origin === 'automatic' ? automaticFeedbackSchema : aiFeedbackSchema).safeParse(raw)
  if (!parsed.success) {
    throw new AiFeedbackError(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  if (!await reserveFeedbackAttempt(userId)) throw new AiFeedbackError(429, 'AI feedback hourly attempt limit reached')
  const reporterId = userId ?? Number(process.env.AI_FEEDBACK_AGENT_USER_ID)
  if (!Number.isSafeInteger(reporterId) || reporterId <= 0) return
  const input: AutomaticFeedbackInput = { ...parsed.data, client: parsed.data.client?.toLowerCase() }
  let plain = false
  let house = false
  try {
    const { featureFlagCandidateUserIds, isFeatureEnabled } = await import('@/lib/flags')
    plain = userId === undefined
      ? await featureFlagCandidateUserIds(HTPR_7536_PLAIN_AI_FEEDBACK_FLAG) === null
      : await isFeatureEnabled(HTPR_7536_PLAIN_AI_FEEDBACK_FLAG, userId)
    if (plain) {
      house = userId === undefined
        ? await featureFlagCandidateUserIds(HTPR_8797_FEEDBACK_HOUSE_PARTS_FLAG) === null
        : await isFeatureEnabled(HTPR_8797_FEEDBACK_HOUSE_PARTS_FLAG, userId)
    }
  } catch {}
  const noteAllowed = reporter.origin === 'agent' && (input.kind !== undefined || input.note !== undefined) && await agentNoteAllowed(userId)
  const stored: StoredNote | undefined = noteAllowed
    ? { kind: input.kind, note: scrubFeedbackNote(input.note ?? '') || undefined }
    : undefined
  const fingerprint = feedbackFingerprint(input, stored)
  const marker = `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p>`
  const doneSections = await prisma.section.findMany({ where: { projectId: PROJECT_ID, OR: [{ isDone: true }, { section_title: { equals: 'Done', mode: 'insensitive' } }] }, select: { id: true, section_title: true } })
  const openWhere = {
    projectId: PROJECT_ID, status: 'Normal' as const,
    AND: [
      { OR: [{ sectionId: null }, { sectionId: { notIn: doneSections.map((item) => item.id) } }] },
      { section: { notIn: doneSections.map((item) => item.section_title) } },
    ],
  }
  const where = { ...openWhere, description_: { is: { content: { contains: marker } } } }
  const closedWhere = {
    projectId: PROJECT_ID, status: 'Normal' as const,
    OR: [{ sectionId: { in: doneSections.map((item) => item.id) } }, { section: { in: doneSections.map((item) => item.section_title) } }],
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
              where: { deleted: false, visibility: true, id: 4389 },
              take: 1, select: { id: true, section_title: true },
            } },
          }),
          userId === undefined ? null : prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
        ])
        const section = project?.section[0]
        if (!project?.uniqueIdentifier || !section) throw new AiFeedbackError(503, 'Feedback destination is not configured')
        const displayName = scrubFeedbackText(user?.displayName ?? '').replace(/,/g, ' ').slice(0, 60) || undefined
        const ticketSelect = { id: true, userId: true, ticketNumber: true, uniqueIndex: true }
        let existing = await tx.task.findFirst({ where, select: ticketSelect })
        if (!existing && tx.comment?.findFirst) {
          const logged = await tx.comment.findFirst({
            where: { agentId: null, text: { contains: marker }, task: openWhere },
            select: { task: { select: ticketSelect } },
          })
          existing = logged?.task ?? null
        }
        if (plain && reporter.origin === 'agent' && scopeRefusal(input) && !existing) {
          console.info('AI feedback not filed: normal access refusal', { surface: input.surface, fingerprint: `ai-fb-${fingerprint.slice(0, 12)}` })
          return { success: false as const, filed: false as const, reason: 'access_refused' as const, error: 'Normal access refusal; no new ticket was filed.' }
        }
        if (reporter.origin === 'agent' && toolOnlyFailure(input) && !existing && await noEvidenceRefused(userId)) {
          console.info('AI feedback not filed: the report names a tool but no status, error code or field', { surface: input.surface, tool: input.tool, fingerprint: `ai-fb-${fingerprint.slice(0, 12)}` })
          return { success: false as const, filed: false as const, reason: 'no_evidence' as const, error: 'No ticket filed: the report names a tool but no HTTP status or error code. Report again with the status and error code of the failed call.' }
        }
        if (reporter.origin === 'automatic' && quietInputRefusal(input) && !existing) {
          console.info('AI feedback not filed: tool input refusal', { surface: input.surface, tool: input.tool, errorCode: input.errorCode, fingerprint: `ai-fb-${fingerprint.slice(0, 12)}` })
          return { success: false as const, filed: false as const, reason: 'input_refused' as const, error: 'Tool input refusal; no new ticket was filed.' }
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
        const logText = (text: string) => house ? text + description(input, fingerprint, displayName, stored) : text
        if (existing) {
          const count = storedCount + 1
          const text = logText(tallyComment(comment?.text ?? '', tallyMarker, count, displayName, input.client))
          const activity = house ? feedbackLogActivity(text) : undefined
          if (comment) {
            await tx.comment.update({ where: { id: comment.id }, data: { text, summary: null, ...(activity ? { activity } : {}) } })
          } else {
            const created = await createCommentService({
              taskId: existing.id, text, creatorId: actorId, ownerId: existing.userId,
              currentUser: { id: actorId }, processTaskReferences: false, trustedCaller: true,
            })
            if (activity && created?.id) {
              await tx.comment.update({ where: { id: created.id }, data: { text, summary: null, activity } })
            }
          }
          changedTaskId = existing.id
          return receipt(existing, true, count, project.uniqueIdentifier)
        }
        const quietFixable = reporter.origin === 'automatic' ? await quietFixableReports(userId) : false
        const closedSelect = { id: true, userId: true, ticketNumber: true, uniqueIndex: true, createdAt: true }
        let recentlyClosed = quietFixable
          ? await tx.task.findFirst({
            where: { ...closedWhere, description_: { is: { content: { contains: marker } } } },
            orderBy: { id: 'desc' }, select: closedSelect,
          })
          : null
        if (quietFixable && !recentlyClosed && tx.comment?.findFirst) {
          const logged = await tx.comment.findFirst({
            where: { agentId: null, text: { contains: marker }, task: closedWhere },
            orderBy: { id: 'desc' }, select: { task: { select: closedSelect } },
          })
          recentlyClosed = logged?.task ?? null
        }
        if (filedRecently(recentlyClosed)) {
          console.info('AI feedback not filed: the same fingerprint was filed in the last day', { fingerprint: `ai-fb-${fingerprint.slice(0, 12)}`, ticket: recentlyClosed.ticketNumber })
          return receipt(recentlyClosed, true, 0, project.uniqueIdentifier)
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
        const readable = plain || stored?.kind ? plainFeedback(input, fingerprint, {
          agentName: scrubFeedbackText(reporter?.agentName ?? '').slice(0, 60) || undefined,
          ownerName: displayName,
          origin: reporter.origin,
        }, stored, house ? 'house' : 'plain') : undefined
        const { task } = await createProvisionedTaskCore({
          creationChannel: "agent",
          title: readable?.title ?? `AI feedback: ${input.surface} ${input.tool ?? input.errorCode ?? input.status ?? 'unexpected-result'}`.slice(0, 80),
          description: (plain ? readable?.description : undefined) ?? description(input, fingerprint, displayName, stored),
          userId: actorId, projectId: PROJECT_ID, sectionId: section.id, sectionTitle: section.section_title,
          projectIdentifier: project.uniqueIdentifier, createDrafts: false, labelIds: [label.id],
          priorityIndex: PriorityConstants.find((priority) => priority.Priority_Value === 'Medium')!.priority_index,
        })
        const text = logText(tallyComment('', tallyMarker, count, displayName, input.client))
        const created = await createCommentService({
          taskId: task.id, text, creatorId: actorId, ownerId: actorId,
          currentUser: { id: actorId }, processTaskReferences: false, trustedCaller: true,
        })
        if (house && created?.id) {
          await tx.comment.update({ where: { id: created.id }, data: { text, summary: null, activity: feedbackLogActivity(text) } })
        }
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
