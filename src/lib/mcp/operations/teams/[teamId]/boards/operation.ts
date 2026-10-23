import { agentScopeEnforced, recordAgentBoardScopeMiss } from "@/lib/auth/agentScope";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { getMcpOperationContext } from '@/lib/mcp/operationContext'
import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { validateBoardManifest } from '@/lib/mcp/boards/validateManifest'
import { createBoardFromManifest } from '@/lib/mcp/boards/createBoardFromManifest'
import { BoardLimitReachedError } from '@/utils/controllers/projects/boardQuota'
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency
} from '@/lib/mcp/idempotency/idempotencyStore'
import { getAgentRole, requireRole } from '@/lib/mcp/agents/scopes'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7509_WRITE_AGENTS_CREATE_BOARDS_FLAG } from '@/lib/flags/keys'

export const runtime = 'nodejs'

type BoardRouteDependencies = {
  createBoardFromManifest: typeof createBoardFromManifest
}

const boardRouteDependencies: BoardRouteDependencies = {
  createBoardFromManifest,
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ teamId: string }> },
  dependencies: BoardRouteDependencies = boardRouteDependencies
) {
  return wrapMcpRoute(async (request: NextRequest) => {
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
      const writeAgentsCreateBoards = await isFeatureEnabled(HTPR_7509_WRITE_AGENTS_CREATE_BOARDS_FLAG, ctx.user.id)
      const scopeError = await requireRole(ctx, writeAgentsCreateBoards ? 'write' : 'admin')
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

    if (ctx.teamScope != null && (teamId !== ctx.teamScope.teamId || !ctx.teamScope.accessBinding?.trim())) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
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

    if (ctx.agentId && await getAgentRole(ctx) !== 'admin') {
      const agent = await prisma.agent.findFirst({
        where: {
          id: ctx.agentId,
          userId: user.id,
          members: { some: { status: 'Accepted', project: { teamId: team.id } } },
        },
        select: { id: true },
      })
      if (!agent) {
        return NextResponse.json(
          {
            success: false,
            error: 'Forbidden',
            message: 'Agent cannot create boards on this team',
            details: { field: 'teamId', code: 'forbidden' },
            ...(correlationId && { correlationId })
          },
          { status: 403 }
        )
      }
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
          userDisplayName: dbUser.displayName,
          creation: {
            method: ctx.agentId ? 'agent' : 'api',
            channel: getMcpOperationContext(request) ? 'mcp' : 'api',
            agentId: ctx.agentId,
          }
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
        produceResponseBody,
        ctx.agentId && agentScopeEnforced() ? ctx.agentId : undefined
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

    if (responseBody.idempotent_replayed) {
      const board = await prisma.project.findFirst({
        where: { id: responseBody.board.id, teamId: team.id, ...projectContentAccessWhere(user.id, ctx.agentId, ctx.teamScope) },
        select: { id: true },
      })
      if (!board) return NextResponse.json({ success: false, error: 'Board not accessible' }, { status: 403 })
      if (ctx.agentId) recordAgentBoardScopeMiss(board.id, 'read')
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
    reportMcpOperationCrash(request, error)
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

  })(request)
}
