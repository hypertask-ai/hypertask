import { NextRequest, NextResponse } from 'next/server'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG } from '@/lib/flags/definitions/htpr-8215-agent-archive-delete'
import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { findIdParamOutOfRange, idOutOfRangeMessage } from '@/lib/mcp/listParams'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import {
  wrapMcpRoute,
  validateMcpRouteAuth,
  checkMcpRouteRateLimit,
  mcpRouteUnauthorizedResponse,
  withMcpRouteMutationLease,
} from '@/lib/mcp/routeWrapper'
import { findTaskByIdentifier, taskIdentifierErrorResponse } from '@/lib/mcp/tasks/resolveTask'
import { postInternalTaskWrite } from '@/lib/mcp/tasks/internalTaskWrite'
import prisma from '@/lib/prisma'

type PutAwayKind = 'archive' | 'delete'

type PutAwayBody = {
  id?: unknown
  task_id?: unknown
  ticket_number?: unknown
  unique_index?: unknown
  project_id?: unknown
}

const KINDS: Record<PutAwayKind, { path: string; status: 'Archive' | 'Deleted'; internalBody: (taskId: number) => Record<string, unknown> }> = {
  archive: {
    path: '/api/tasks/(un)archive',
    status: 'Archive',
    internalBody: (taskId) => ({ taskId, status: 'Archive' }),
  },
  delete: {
    path: '/api/queues/tasks/taskDeleteReminder',
    status: 'Deleted',
    internalBody: (taskId) => ({ taskId }),
  },
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export function putAwayTaskRoute(kind: PutAwayKind) {
  const target = KINDS[kind]
  return async function POST(request: NextRequest) {
    return wrapMcpRoute(async (request: NextRequest) => {
      try {
        const rateLimited = await checkMcpRouteRateLimit(request)
        if (rateLimited) return rateLimited
        const ctx = await validateMcpRouteAuth(request)
        if (!ctx) return await mcpRouteUnauthorizedResponse(request)
        const roleRefusal = await requireAgentWriteRole(ctx)
        if (roleRefusal) return roleRefusal
        if (!(await isFeatureEnabled(HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG, ctx.user.id))) {
          return NextResponse.json({ success: false, error: `Task ${kind} is not enabled` }, { status: 404 })
        }

        const parsed = await readJsonBody<PutAwayBody>(request)
        if (!parsed.ok) return parsed.response
        const body = parsed.body

        const taskId = positiveInteger(body.task_id ?? body.id)
        const uniqueIndex = positiveInteger(body.unique_index)
        const projectId = positiveInteger(body.project_id)
        const ticketNumber = typeof body.ticket_number === 'string' && body.ticket_number.trim() ? body.ticket_number.trim() : undefined
        const supplied = [taskId, ticketNumber, uniqueIndex].filter((value) => value !== undefined)
        if (supplied.length !== 1 || (uniqueIndex !== undefined && projectId === undefined)) {
          return NextResponse.json(
            buildFieldError('invalid_field', 'task_id', 'Provide exactly one of task_id, ticket_number, or (project_id + unique_index)'),
            { status: 400 },
          )
        }
        const outOfRange = findIdParamOutOfRange({ task_id: taskId, unique_index: uniqueIndex, project_id: projectId })
        if (outOfRange) {
          return NextResponse.json(buildFieldError('invalid_field', outOfRange, idOutOfRangeMessage(outOfRange)), { status: 400 })
        }

        const task = await findTaskByIdentifier(
          ctx.user,
          { task_id: taskId, ticket_number: ticketNumber, unique_index: uniqueIndex, project_id: projectId },
          ctx.agentId,
          undefined,
          ctx.teamScope,
        )
        if (!task) {
          return NextResponse.json({ success: false, error: 'Task not found or access denied' }, { status: 404 })
        }

        const write = await withMcpRouteMutationLease(
          prisma,
          { agentId: ctx.agentId, userId: ctx.user.id },
          () => postInternalTaskWrite(ctx, target.path, target.internalBody(task.id)),
        )
        if (!write.ok) {
          const message = (write.data as { message?: unknown; error?: unknown } | null)
          const text = typeof message?.message === 'string' ? message.message : typeof message?.error === 'string' ? message.error : `Task ${kind} failed`
          if (write.status >= 500) {
            console.error(`[MCP ${kind} task] internal write failed`, write.status, text)
            return NextResponse.json({ success: false, error: `Task ${kind} failed` }, { status: 502 })
          }
          return NextResponse.json({ success: false, error: text }, { status: write.status })
        }

        const stored = await prisma.task.findUnique({
          where: { id: task.id },
          select: { id: true, ticketNumber: true, projectId: true, status: true, archivedAt: true, permanentlyDeleteAt: true },
        })
        return NextResponse.json({ success: true, task: stored }, { status: 200 })
      } catch (error) {
        const identifierResponse = taskIdentifierErrorResponse(error)
        if (identifierResponse) return identifierResponse
        console.error(`/api/mcp/tasks/${kind}`, error)
        reportMcpOperationCrash(request, error)
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
      }
    })(request)
  }
}
