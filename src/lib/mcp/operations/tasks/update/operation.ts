import { findIdParamOutOfRange, idOutOfRangeMessage } from '@/lib/mcp/listParams'
import { taskIdentifierErrorResponse } from '@/lib/mcp/tasks/resolveTask'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency,
} from '@/lib/mcp/idempotency/idempotencyStore'
import prisma from '@/lib/prisma'
import { withAdoptedAgentMutationLease } from '@/lib/mcp/tasks/agentMutationLeaseAdoption'
import {
  executeTaskUpdate,
  type UpdateTaskBody,
  type UpdateTaskResponse,
} from '@/lib/mcp/tasks/updateTaskSelector'

export type { UpdateTaskResponse } from '@/lib/mcp/tasks/updateTask'

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  console.log('[MCP Update Task] Request received')

  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited
  const ctx = await validateMcpAuth(request)
  if (!ctx) {
    console.log('[MCP Update Task] Authentication failed')
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    )
  }
  console.log('[MCP Update Task] User authenticated:', ctx.user.id)

  const parsedBody = await readJsonBody<UpdateTaskBody>(request)
  if (!parsedBody.ok) return parsedBody.response
  const requestBody = parsedBody.body
  console.log('🚀 ~ POST ~ requestBody:', requestBody)

  if (
    requestBody.dry_run !== undefined &&
    typeof requestBody.dry_run !== 'boolean'
  ) {
    return NextResponse.json(
      buildFieldError('invalid_field', 'dry_run', 'dry_run must be a boolean'),
      { status: 400 }
    )
  }
  const outOfRange = findIdParamOutOfRange({ sectionId: requestBody.sectionId, assignee: requestBody.assignee, parent_task_id: requestBody.parent_task_id })
  if (outOfRange) {
    return NextResponse.json(
      buildFieldError('invalid_field', outOfRange, idOutOfRangeMessage(outOfRange)),
      { status: 400 }
    )
  }
  const dryRun = requestBody.dry_run ?? false
  const { dry_run: _dryRun, ...requestBodyForHashing } = requestBody

  let clientIdempotencyKey: string | null
  try {
    clientIdempotencyKey = normalizeIdempotencyKey(
      request.headers.get('Idempotency-Key')
    )
  } catch (error) {
    return NextResponse.json(
      {
        ...buildFieldError(
          'invalid_field',
          'Idempotency-Key',
          error instanceof Error
            ? error.message
            : 'Invalid Idempotency-Key header'
        ),
        ...(dryRun && { valid: false }),
      },
      { status: 400 }
    )
  }

  try {
    const result = await withAdoptedAgentMutationLease(
      prisma,
      { agentId: ctx.agentId, userId: ctx.user.id },
      () =>
        executeTaskUpdate({
          request,
          ctx,
          requestBody,
          dryRun,
          persist: (persistTaskUpdates) =>
            withIdempotency(
              'update_task',
              ctx.user.id,
              clientIdempotencyKey,
              requestBodyForHashing,
              persistTaskUpdates
            ) as Promise<UpdateTaskResponse>,
        })
    )

    return result.response
  } catch (error) {
    const identifierResponse = taskIdentifierErrorResponse(error)
    if (identifierResponse) return identifierResponse
    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 409 }
      )
    }
    throw error
  }

  })(request)
}
