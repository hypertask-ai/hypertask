import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8839_EVIDENCE_BOARD_NUMBER_FLAG } from '@/lib/flags/definitions/htpr-8839-evidence-board-number'
import type { McpAuthContext } from '@/lib/mcp/auth/types'
import { findTaskByIdentifier, taskIdentifierErrorResponse } from '@/lib/mcp/tasks/resolveTask'
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

type EvidenceIds = {
  taskId: number | null
  ticketNumber: string | null
  uniqueIndex: number | null
  projectId: number | null
}

async function boardNumberLookupEnabled(userId: number) {
  try {
    return await isFeatureEnabled(HTPR_8839_EVIDENCE_BOARD_NUMBER_FLAG, userId)
  } catch {
    return false
  }
}

async function resolveEvidenceTask(ctx: McpAuthContext, ids: EvidenceIds, enabled: boolean) {
  const lookup = (options: {
    task_id?: number | null
    ticket_number?: string | null
    unique_index?: number | null
    project_id?: number | null
  }) => findTaskByIdentifier(ctx.user, options, ctx.agentId, undefined, ctx.teamScope)
  if (!enabled) {
    return {
      task: await lookup({ task_id: ids.taskId, ticket_number: ids.ticketNumber, project_id: ids.projectId }),
    }
  }
  if (ids.taskId === null && ids.ticketNumber === null && ids.uniqueIndex !== null && ids.projectId === null) {
    return { missingProject: true as const, task: null }
  }
  const task = await lookup({
    task_id: ids.taskId,
    ticket_number: ids.ticketNumber,
    unique_index: ids.uniqueIndex,
    project_id: ids.projectId,
  })
  if (ids.ticketNumber || ids.uniqueIndex != null || ids.taskId === null || ids.projectId === null) {
    return { task }
  }
  const byBoardNumber = await lookup({ unique_index: ids.taskId, project_id: ids.projectId })
  if (task && byBoardNumber && byBoardNumber.id !== task.id) return { ambiguous: true as const, task: null }
  return { task: task ?? byBoardNumber }
}

function notFound() {
  return NextResponse.json(
    { success: false, error: 'Task not found or access denied' },
    { status: 404 }
  )
}

function identifierProblem(resolved: { missingProject?: boolean; ambiguous?: boolean; task: { id: number } | null }) {
  if (resolved.missingProject) return validationError('project_id is required when using unique_index', 'project_id')
  if (resolved.ambiguous) {
    return validationError(
      'task_id matches a different task id and board number on this project; use ticket_number or unique_index',
      'task_id',
    )
  }
  if (!resolved.task) return notFound()
  return null
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()
    const roleRefusal = await requireAgentWriteRole(ctx)
    if (roleRefusal) return roleRefusal

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

    const ids = {
      taskId: idFor(body.task_id),
      ticketNumber: ticketFor(body.ticket_number),
      uniqueIndex: idFor(body.unique_index),
      projectId: idFor(body.project_id),
    }
    const enabled = await boardNumberLookupEnabled(ctx.user.id)
    if (ids.taskId === null && ids.ticketNumber === null && !(enabled && ids.uniqueIndex !== null)) {
      return validationError('Provide task_id or ticket_number', 'task_id')
    }

    const parsed = parseEvidenceInput(body)
    if (!parsed.ok) return validationError(parsed.error, parsed.field)

    const resolved = await resolveEvidenceTask(ctx, ids, enabled)
    const problem = identifierProblem(resolved)
    if (problem || !resolved.task) return problem ?? notFound()

    const evidence = await prisma.taskEvidence.create({
      data: {
        taskId: resolved.task.id,
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
    const identifierResponse = taskIdentifierErrorResponse(error)
    if (identifierResponse) return identifierResponse
    console.error('[MCP Task Evidence] POST Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) return unauthorized()

    const sp = request.nextUrl.searchParams
    const ids = {
      taskId: idFor(Number(sp.get('task_id'))),
      ticketNumber: ticketFor(sp.get('ticket_number')),
      uniqueIndex: idFor(Number(sp.get('unique_index'))),
      projectId: idFor(Number(sp.get('project_id'))),
    }
    const enabled = await boardNumberLookupEnabled(ctx.user.id)
    if (ids.taskId === null && ids.ticketNumber === null && !(enabled && ids.uniqueIndex !== null)) {
      return validationError('Provide task_id or ticket_number', 'task_id')
    }

    const resolved = await resolveEvidenceTask(ctx, ids, enabled)
    const problem = identifierProblem(resolved)
    if (problem || !resolved.task) return problem ?? notFound()

    const evidence = await prisma.taskEvidence.findMany({
      where: { taskId: resolved.task.id },
      select: {
        id: true, type: true, title: true, url: true, summary: true, createdAt: true, agentId: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ success: true, taskId: resolved.task.id, evidence })
  } catch (error) {
    const identifierResponse = taskIdentifierErrorResponse(error)
    if (identifierResponse) return identifierResponse
    console.error('[MCP Task Evidence] GET Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}
