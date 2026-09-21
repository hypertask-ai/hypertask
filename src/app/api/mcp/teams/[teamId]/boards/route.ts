import { NextRequest, NextResponse } from 'next/server'
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { validateBoardManifest } from '@/lib/mcp/boards/validateManifest'
import { createBoardFromManifest } from '@/lib/mcp/boards/createBoardFromManifest'
import { BoardLimitReachedError } from '@/utils/controllers/projects/boardQuota'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency
} from '@/lib/mcp/idempotency/idempotencyStore'
import { requireRole } from '@/lib/mcp/agents/scopes'

export const runtime = 'nodejs'

type BoardRouteDependencies = {
  createBoardFromManifest: typeof createBoardFromManifest
}

const boardRouteDependencies: BoardRouteDependencies = {
  createBoardFromManifest,
}

/**
 * POST /api/mcp/teams/:teamId/boards
 *
 * Creates one board (project) under the team from a structured manifest.
 * teamId is the Team UUID (see GET /api/mcp/user/context → teams[].id).
 *
 * Label `color` in the manifest is accepted but not persisted (Label model has no color column).
 *
 * Optional `Idempotency-Key` header: replays with the same key + same body return the cached
 * successful response for 24h (Redis); no duplicate board. A same-key retry while the original
 * request is still in flight returns 409 and tells the caller to retry shortly.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ teamId: string }> },
  dependencies: BoardRouteDependencies = boardRouteDependencies
) {
  const params = await props.params;
  const correlationId = request.headers.get('X-Correlation-ID')

  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication error',
          message: 'Invalid or expired JWT token',
          ...(correlationId && { correlationId })
        },
        { status: 401 }
      )
    }
    if (ctx.agentId) {
      const scopeError = await requireRole(ctx, 'admin')
      if (scopeError) return scopeError
    }
    const user = ctx.user;
    const teamId = params.teamId?.trim()
    if (!teamId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'teamId is required',
          details: { field: 'teamId', code: 'missing' },
          ...(correlationId && { correlationId })
        },
        { status: 400 }
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountId: true
      }
    })

    if (!dbUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'User not found',
          ...(correlationId && { correlationId })
        },
        { status: 404 }
      )
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, googleAccountId: true }
    })

    if (!team) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not found',
          message: 'Team not found',
          details: { field: 'teamId', code: 'not_found' },
          ...(correlationId && { correlationId })
        },
        { status: 404 }
      )
    }

    const membership = await prisma.member_Team.findFirst({
      where: {
        userId: user.id,
        teamId: team.id,
        status: 'Accepted'
      },
      select: { id: true }
    })

    const ownsTeam =
      dbUser.accountId != null && dbUser.accountId === team.googleAccountId

    if (!membership && !ownsTeam) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'User cannot create boards on this team',
          details: { field: 'teamId', code: 'forbidden' },
          ...(correlationId && { correlationId })
        },
        { status: 403 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation error',
          message: 'Invalid JSON body',
          details: { field: 'body', code: 'invalid_json' },
          ...(correlationId && { correlationId })
        },
        { status: 400 }
      )
    }

    const validated = validateBoardManifest(body)
    if (!validated.ok) {
      return NextResponse.json(
        {
          success: false,
          error: 'validation_error',
          message: validated.message,
          details: { field: validated.field, code: validated.code },
          ...(correlationId && { correlationId })
        },
        { status: 400 }
      )
    }

    let clientIdempotencyKey: string | null
    try {
      clientIdempotencyKey = normalizeIdempotencyKey(
        request.headers.get('Idempotency-Key') ?? request.headers.get('idempotency-key')
      )
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: 'validation_error',
          message:
            e instanceof Error ? e.message : 'Invalid Idempotency-Key header',
          details: { field: 'Idempotency-Key', code: 'invalid_length' },
          ...(correlationId && { correlationId })
        },
        { status: 400 }
      )
    }

    const produceResponseBody = async () => {
      const { board, sections, labels, tasks } =
        await dependencies.createBoardFromManifest({
          teamId: team.id,
          googleAccountId: team.googleAccountId,
          manifest: validated.data,
          userId: user.id,
          userEmail: dbUser.email,
          userDisplayName: dbUser.displayName
        })

      return {
        success: true as const,
        team_id: team.id,
        board,
        sections,
        labels,
        tasks,
        message: 'Board created successfully'
      }
    }

    let responseBody
    try {
      responseBody = await withIdempotency(
        'create_board',
        user.id,
        clientIdempotencyKey,
        { teamId: team.id, manifest: validated.data },
        produceResponseBody
      )
    } catch (error) {
      if (error instanceof IdempotencyInProgressError) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            ...(correlationId && { correlationId })
          },
          { status: 409 }
        )
      }
      if (error instanceof BoardLimitReachedError) {
        return NextResponse.json(
          {
            success: false,
            error: 'board_limit_reached',
            message: error.message,
            details: { field: 'board', code: 'board_limit_reached' },
            ...(correlationId && { correlationId })
          },
          { status: 403 }
        )
      }
      throw error
    }

    return NextResponse.json(
      {
        ...responseBody,
        ...(correlationId && { correlationId })
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[MCP Create Board] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message:
          error instanceof Error ? error.message : 'An unexpected error occurred',
        ...(correlationId && { correlationId })
      },
      { status: 500 }
    )
  }
}
