import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency,
} from '@/lib/mcp/idempotency/idempotencyStore'
import { withAgentMutationLeaseAdoption } from '@/lib/mcp/tasks/agentMutationLeaseAdoption'
import {
  executeTaskUpdate,
  type UpdateTaskBody,
  type UpdateTaskResponse,
} from '@/lib/mcp/tasks/updateTask'

export type { UpdateTaskResponse } from '@/lib/mcp/tasks/updateTask'

export async function POST(request: NextRequest) {
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
    // Agent callers should not have to claim a mutation lease by hand. This
    // request may adopt one on its first fenced transaction; every later
    // transaction in the same request stays strict.
    const result = await withAgentMutationLeaseAdoption(
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
    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 409 }
      )
    }
    throw error
  }
}
