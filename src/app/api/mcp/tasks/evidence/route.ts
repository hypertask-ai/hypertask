import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask'
import { parseEvidenceInput } from '@/lib/mcp/tasks/evidence'

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

/**
 * POST /api/mcp/tasks/evidence
 * Attach typed proof-of-work (test run, screenshot, deploy link, diff) to a task.
 * Body: { task_id | ticket_number, project_id?, type?, title?, url?, summary? }.
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

    const parsed = parseEvidenceInput(body)
    if (!parsed.ok) return validationError(parsed.error, parsed.field)

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

    const evidence = await prisma.taskEvidence.create({
      data: {
        taskId: task.id,
        type: parsed.value.type,
        title: parsed.value.title,
        url: parsed.value.url,
        summary: parsed.value.summary,
        creatorId: ctx.user.id,
        agentId: ctx.agentId ?? null,
      },
      select: {
        id: true, type: true, title: true, url: true, summary: true, createdAt: true, agentId: true,
      },
    })

    return NextResponse.json({ success: true, evidence }, { status: 201 })
  } catch (error) {
    console.error('[MCP Task Evidence] POST Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/mcp/tasks/evidence?task_id|ticket_number&project_id
 * List the evidence attached to a task, newest first.
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

    const evidence = await prisma.taskEvidence.findMany({
      where: { taskId: task.id },
      select: {
        id: true, type: true, title: true, url: true, summary: true, createdAt: true, agentId: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, taskId: task.id, evidence })
  } catch (error) {
    console.error('[MCP Task Evidence] GET Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
