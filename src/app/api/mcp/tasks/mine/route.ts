import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import {
  getMyTasksSummary,
  MY_TASKS_DEFAULT_LIMIT,
  MY_TASKS_MAX_LIMIT,
} from '@/lib/mcp/tasks/myTasksSummary'

function parsePositiveInteger(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null
  const value = Number(raw.trim())
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * GET /api/mcp/tasks/mine
 *
 * Everything assigned to the caller across every board they can see, grouped
 * per board, with exact totals. Same set and same shape the AI chat's
 * hypertask_my_tasks tool returns, so the CLI, MCP and the chat agree.
 */
export async function GET(request: NextRequest) {
  try {
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

    const searchParams = request.nextUrl.searchParams
    const projectIdRaw = searchParams.get('project_id')
    if (projectIdRaw !== null && parsePositiveInteger(projectIdRaw) === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'project_id must be a positive integer',
        },
        { status: 400 }
      )
    }

    const limitRaw = searchParams.get('limit')
    if (limitRaw !== null && parsePositiveInteger(limitRaw) === null) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'limit must be a positive integer',
        },
        { status: 400 }
      )
    }

    const result = await getMyTasksSummary({
      userId: ctx.user.id,
      agentId: ctx.agentId,
      projectId: parsePositiveInteger(projectIdRaw),
      overdueOnly: searchParams.get('overdue_only') === 'true',
      includeTasks: searchParams.get('include_tasks') !== 'false',
      limit: Math.min(
        parsePositiveInteger(limitRaw) ?? MY_TASKS_DEFAULT_LIMIT,
        MY_TASKS_MAX_LIMIT
      ),
    })

    if (!result.success) {
      return NextResponse.json(result, { status: 404 })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    console.error('Error listing my tasks:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred while listing your tasks',
      },
      { status: 500 }
    )
  }
}
