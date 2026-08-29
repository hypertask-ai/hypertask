import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { normalizeSessionStatus, sessionStatuses } from '@/lib/mcp/tasks/sessionStatus'

function unauthorized() {
  return NextResponse.json(
    { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
    { status: 401 }
  )
}
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

const SESSION_SELECT = {
  sessionId: true,
  taskId: true,
  resumeCommand: true,
  status: true,
  agentId: true,
  startedById: true,
  createdAt: true,
  lastSeenAt: true,
} as const

/**
 * POST /api/mcp/tasks/session
 * Attach or refresh an agent work-session on a ticket. Keyed by session_id, so a
 * repeated call from the same session upserts one row (a heartbeat).
 * Body: { task_id | ticket_number, project_id?, session_id, resume_command?, status? }.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()

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

    const sessionId = ticketFor(body.session_id)
    if (sessionId === null) {
      return validationError('session_id is required', 'session_id')
    }
    if (sessionId.length > 200) {
      return validationError('session_id may be at most 200 characters', 'session_id')
    }

    const status = normalizeSessionStatus(body.status)
    if (status === null) {
      return validationError(`status must be one of ${sessionStatuses.join(', ')}`, 'status')
    }

    let resumeCommand: string | undefined
    if (body.resume_command !== undefined && body.resume_command !== null) {
      if (typeof body.resume_command !== 'string') {
        return validationError('resume_command must be a string', 'resume_command')
      }
      const rc = body.resume_command.trim()
      if (rc.length > 1000) {
        return validationError('resume_command may be at most 1000 characters', 'resume_command')
      }
      resumeCommand = rc === '' ? undefined : rc
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

    // session_id is semi-public (resume strings get posted in comments), so an
    // upsert keyed only on it would let anyone overwrite another agent's session.
    // A session may only be written by the user/agent that started it. Existence
    // is checked first and ownership enforced before any write.
    const existing = await prisma.taskSession.findUnique({
      where: { sessionId },
      select: { startedById: true, agentId: true, taskId: true },
    })
    if (existing) {
      // The update must target the session's real task — which we just access-
      // checked via findTaskByIdentifier. This prevents refreshing a session on a
      // project the caller can no longer see by naming some other reachable task.
      if (existing.taskId !== task.id) {
        return NextResponse.json(
          { success: false, error: 'Session not found or access denied' },
          { status: 404 }
        )
      }
      const ownedByCaller = ctx.agentId !== null
        ? existing.agentId === ctx.agentId
        : existing.startedById === ctx.user.id
      if (!ownedByCaller) {
        return NextResponse.json(
          { success: false, error: 'This session belongs to a different owner' },
          { status: 403 }
        )
      }
      // A session stays bound to its original task; a heartbeat only refreshes state.
      const session = await prisma.taskSession.update({
        where: { sessionId },
        data: {
          status,
          lastSeenAt: new Date(),
          ...(resumeCommand !== undefined ? { resumeCommand } : {}),
        },
        select: SESSION_SELECT,
      })
      return NextResponse.json({ success: true, session })
    }

    try {
      const session = await prisma.taskSession.create({
        data: {
          sessionId,
          taskId: task.id,
          resumeCommand,
          status,
          agentId: ctx.agentId ?? null,
          startedById: ctx.user.id,
        },
        select: SESSION_SELECT,
      })
      return NextResponse.json({ success: true, session })
    } catch (err) {
      // Same-owner heartbeat race: another concurrent first-POST created the row
      // between our existence check and this insert (P2002 unique violation).
      // Re-run the ownership-gated update path rather than 500.
      if (
        err &&
        typeof err === 'object' &&
        (err as { code?: string }).code === 'P2002'
      ) {
        const owned = await prisma.taskSession.findUnique({
          where: { sessionId },
          select: { startedById: true, agentId: true, taskId: true },
        })
        if (!owned || owned.taskId !== task.id) {
          return NextResponse.json(
            { success: false, error: 'Session not found or access denied' },
            { status: 404 }
          )
        }
        const ownedByCaller = ctx.agentId !== null
          ? owned.agentId === ctx.agentId
          : owned.startedById === ctx.user.id
        if (!ownedByCaller) {
          return NextResponse.json(
            { success: false, error: 'This session belongs to a different owner' },
            { status: 403 }
          )
        }
        const session = await prisma.taskSession.update({
          where: { sessionId },
          data: {
            status,
            lastSeenAt: new Date(),
            ...(resumeCommand !== undefined ? { resumeCommand } : {}),
          },
          select: SESSION_SELECT,
        })
        return NextResponse.json({ success: true, session })
      }
      throw err
    }
  } catch (error) {
    console.error('[MCP Task Session] POST Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/mcp/tasks/session?task_id|ticket_number&project_id
 * List the work-sessions attached to a task, most-recently-seen first.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()

    const sp = request.nextUrl.searchParams
    const taskId = idFor(Number(sp.get('task_id')))
    const ticketNumber = ticketFor(sp.get('ticket_number'))
    const projectId = idFor(Number(sp.get('project_id')))
    if (taskId === null && ticketNumber === null) {
      return validationError('Provide task_id or ticket_number', 'task_id')
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

    const sessions = await prisma.taskSession.findMany({
      where: { taskId: task.id },
      select: SESSION_SELECT,
      orderBy: { lastSeenAt: 'desc' },
    })

    return NextResponse.json({ success: true, taskId: task.id, sessions })
  } catch (error) {
    console.error('[MCP Task Session] GET Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
