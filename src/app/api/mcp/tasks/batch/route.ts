import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import {
  handleBatchBody,
  type BatchBody,
} from '@/lib/mcp/tasks/batchTasks'

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request)
  if (rateLimited) return rateLimited
  const ctx = await validateMcpAuth(request)
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized. Invalid or missing authentication token.',
      },
      { status: 401 }
    )
  }

  let body: BatchBody
  try {
    body = (await request.json()) as BatchBody
  } catch {
    return NextResponse.json(
      buildFieldError(
        'invalid_field',
        'body',
        'Request body must be valid JSON'
      ),
      { status: 400 }
    )
  }

  return handleBatchBody(request, ctx, body)
}
