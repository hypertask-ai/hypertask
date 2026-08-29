import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { createCommentService } from '@/utils/controllers/comments/createCommentService'
import { sanitizeRichHtml } from '@/utils/helperFunctions/sanitizeRichHtml'
import { buildEscalationCommentHtml } from '@/lib/mcp/tasks/escalationHtml'
import type { WebhookDelivery } from '@/lib/mcp/webhooks/events'

function validationError(message: string, field?: string) {
  return NextResponse.json(
    { success: false, error: message, code: 'invalid_field', ...(field ? { field } : {}) },
    { status: 400 }
  )
}
const idFor = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null
const ticketFor = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null

const MAX_REASON = 2000
const MAX_SUMMARY = 5000

/**
 * POST /api/mcp/tasks/escalate
 * A stuck agent asks a human for help: posts a flagged escalation comment on the
 * task (which fires the normal owner/assignee/follower notifications) with the
 * reason and a summary of what was already tried, so nothing fails silently.
 * Body: { task_id | ticket_number, project_id?, reason, attempts_summary? }.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    let body: Record<string, unknown>
    try {
      const parsed = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return validationError('Request body must be a JSON object')
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 })
    }

    const taskId = idFor(body.task_id)
    const ticketNumber = ticketFor(body.ticket_number)
    const projectId = idFor(body.project_id)
    if (taskId === null && ticketNumber === null) {
      return validationError('Provide task_id or ticket_number', 'task_id')
    }

    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      return validationError('reason is required', 'reason')
    }
    const reason = body.reason.trim()
    if (reason.length > MAX_REASON) {
      return validationError(`reason may be at most ${MAX_REASON} characters`, 'reason')
    }

    let attemptsSummary: string | undefined
    if (body.attempts_summary !== undefined && body.attempts_summary !== null) {
      if (typeof body.attempts_summary !== 'string') {
        return validationError('attempts_summary must be a string', 'attempts_summary')
      }
      const s = body.attempts_summary.trim()
      if (s.length > MAX_SUMMARY) {
        return validationError(`attempts_summary may be at most ${MAX_SUMMARY} characters`, 'attempts_summary')
      }
      attemptsSummary = s === '' ? undefined : s
    }

    const task = await findTaskByIdentifier(
      ctx.user,
      { task_id: taskId, ticket_number: ticketNumber, project_id: projectId },
      ctx.agentId
    )
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const [taskOwner, currentUser] = await Promise.all([
      prisma.task.findUnique({
        where: { id: task.id },
        select: { userId: true, title: true, ticketNumber: true },
      }),
      prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { id: true, email: true, displayName: true, photoURL: true },
      }),
    ])
    if (!taskOwner || !currentUser) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      )
    }

    const html = sanitizeRichHtml(buildEscalationCommentHtml({ reason, attemptsSummary }))

    // createCommentService is the single source of truth for comment + owner/
    // assignee/follower notifications + email + FCM, so escalating this way reaches
    // the human through every channel they already receive comments on.
    // HTPR-4530: the comment already fires comment.created; escalation is a
    // distinct signal, so board subscribers also get task.escalated. It rides
    // the comment's own transaction, so the event cannot be lost after the
    // comment commits, and a retry that hits the comment idempotency path does
    // not emit a second time.
    const escalatedEvent: WebhookDelivery = {
      event: 'task.escalated',
      data: {
        task: {
          id: task.id,
          ticketNumber: taskOwner.ticketNumber ?? null,
          projectId: task.projectId,
          title: taskOwner.title,
        },
        reason,
        actor: { userId: ctx.user.id, agentId: ctx.agentId ?? null },
      },
    }

    const comment = await createCommentService({
      text: html,
      creatorId: ctx.user.id,
      taskId: task.id,
      ownerId: taskOwner.userId,
      currentUser,
      agentId: ctx.agentId ?? undefined,
      extraBoardWebhookEvents: [escalatedEvent],
    })

    return NextResponse.json(
      { success: true, escalated: true, taskId: task.id, commentId: comment.id },
      { status: 201 }
    )
  } catch (error) {
    console.error('[MCP Task Escalate] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
