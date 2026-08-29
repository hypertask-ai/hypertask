import { NextRequest, NextResponse } from 'next/server'
import { getTeamGatewayFunding } from '@/app/api/ai/_lib/byokKeys'
import {
  aggregateGatewayTeamUsage,
  gatewayBillingPeriodRange,
  gatewayGet,
} from '@/app/api/settings/ai-usage/gatewayUsage'
import {
  checkMcpRateLimit,
  extractBearerToken,
  isManagementKeyToken,
  type McpAuthContext,
  validateMcpAuth,
} from '@/lib/mcp/auth'
import {
  hasDataPermission,
  hasUsageReadPermission,
} from '@/lib/mcp/managementPermissions'
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

const GROUPS = ['model', 'feature', 'user', 'provider', 'task', 'agent'] as const
type GroupBy = (typeof GROUPS)[number]
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MCP_USAGE_REPORT_MAX_BYTES = 2 * 1024 * 1024

// Map the API-facing group name to the real AiUsage column. 'user' is exposed
// but the column is 'userId' — the unknown-cast on groupBy() below hides this
// from the compiler, so it must be mapped by hand.
const DB_FIELD: Record<GroupBy, string> = {
  model: 'model',
  feature: 'feature',
  user: 'userId',
  provider: 'provider',
  task: 'taskId',
  agent: 'agentId',
}

function validationError(message: string, field?: string) {
  return NextResponse.json(
    { success: false, error: message, code: 'invalid_field', ...(field ? { field } : {}) },
    { status: 400 }
  )
}

type TeamUsageTotals = {
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const usageUnauthorized = () =>
  NextResponse.json(
    {
      success: false,
      error: 'Unauthorized. This endpoint requires a usage management key.',
    },
    { status: 401 },
  )

/**
 * Management-key branch of this route. It intentionally has no project or
 * member grouping, so a usage key can expose only team-wide counts and spend.
 */
async function getTeamUsage(ctx: McpAuthContext, request: NextRequest) {
  // Management keys are account-owner credentials, not team-scoped keys. The
  // requested team is still checked against the owner's teams below on every
  // call, so a key cannot cross the account boundary or read a member team.
  const requestedTeamId = request.nextUrl.searchParams.get('team_id')?.trim()
  if (requestedTeamId && !UUID_PATTERN.test(requestedTeamId)) {
    return validationError('team_id must be a valid UUID', 'team_id')
  }

  let teamId = requestedTeamId || null

  if (!teamId) {
    let ownedTeams
    try {
      ownedTeams = await prisma.team.findMany({
        where: {
          googleAccount: { userId: ctx.user.id },
        },
        select: { id: true },
        take: 2,
      })
    } catch (error) {
      console.error('[MCP AI Usage] Owned-team lookup unavailable:', error)
      return NextResponse.json(
        { success: false, error: 'Could not load AI usage' },
        { status: 502 },
      )
    }

    if (ownedTeams.length !== 1) {
      return NextResponse.json(
        {
          success: false,
          error:
            ownedTeams.length > 1
              ? 'team_id is required when you own more than one team'
              : 'team_id is required',
          code: 'invalid_field',
          field: 'team_id',
        },
        { status: 400 },
      )
    }
    teamId = ownedTeams[0].id
  }

  const { endDate, startDate } = gatewayBillingPeriodRange()
  let usage: TeamUsageTotals
  try {
    const snapshot = await prisma.$transaction(
      async (tx) => {
        const team = await tx.team.findFirst({
          where: {
            id: teamId,
            googleAccount: { userId: ctx.user.id },
          },
          select: {
            id: true,
          },
        })
        if (!team) return null

        const totals = await tx.aiUsage.aggregate({
          where: {
            teamId,
            createdAt: {
              gte: new Date(`${startDate}T00:00:00.000Z`),
              lte: new Date(`${endDate}T23:59:59.999Z`),
            },
          },
          _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
          _count: { _all: true },
        })

        return { team, totals }
      },
      { isolationLevel: 'Serializable' },
    )
    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: 'Team not found or access denied' },
        { status: 404 },
      )
    }

    usage = {
      inputTokens: snapshot.totals._sum.inputTokens ?? 0,
      outputTokens: snapshot.totals._sum.outputTokens ?? 0,
      requests: snapshot.totals._count._all,
      totalTokens: snapshot.totals._sum.totalTokens ?? 0,
    }
  } catch (error) {
    console.error('[MCP AI Usage] Team usage snapshot unavailable:', error)
    return NextResponse.json(
      { success: false, error: 'Could not load AI usage' },
      { status: 502 },
    )
  }

  try {
    const funding = await getTeamGatewayFunding({ trustedTeamId: teamId })
    let spendUsd: number | null = null
    if (funding) {
      if (!funding.apiKey) {
        throw new Error('AI Gateway funding key unavailable')
      }

      const reportParams = new URLSearchParams({
        end_date: endDate,
        group_by: 'day',
        start_date: startDate,
        tags: `team:${teamId}`,
      })
      const reportResponse = await gatewayGet(
        `/report?${reportParams.toString()}`,
        funding.apiKey,
        { maxBytes: MCP_USAGE_REPORT_MAX_BYTES },
      )
      if (!reportResponse.ok) {
        throw new Error(`AI Gateway report returned ${reportResponse.status}`)
      }

      const gatewayUsage = aggregateGatewayTeamUsage(await reportResponse.json())
      spendUsd = Math.max(gatewayUsage.totalCost, 0)
    }

    // Lock the team row while checking ownership and constructing the response.
    // Team transfers update googleAccountId, so the lock makes a transfer wait
    // until this response has been built and the transaction has committed.
    const response = await prisma.$transaction(
      async (tx) => {
        const lockedTeam = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT t."id"
          FROM "Team" AS t
          INNER JOIN "GoogleAccount" AS ga ON ga."id" = t."googleAccountId"
          WHERE t."id" = ${teamId}
            AND ga."userId" = ${ctx.user.id}
          FOR UPDATE OF t, ga
        `
        if (lockedTeam.length === 0) return null

        return NextResponse.json({
          success: true,
          teamId,
          period: { endDate, startDate },
          spendUsd,
          usage,
        })
      },
      { isolationLevel: 'Serializable' },
    )
    if (!response) {
      return NextResponse.json(
        { success: false, error: 'Team not found or access denied' },
        { status: 404 },
      )
    }

    return response
  } catch (error) {
    console.error('[MCP AI Usage] Failed to load AI spend:', error)
    return NextResponse.json(
      { success: false, error: 'Could not load AI usage' },
      { status: 502 },
    )
  }
}

/**
 * GET /api/mcp/ai/usage?project_id=&group_by=model|feature|user|provider|task|agent&since=ISO
 * Read-only AI token usage for a board, grouped by the requested dimension.
 * A management key with usage read permission may instead call this route with
 * `team_id` (and without `project_id`) to receive only team-wide current-period
 * counts and model spend. It never receives plan, billing, payment, or member
 * data.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const searchParams = request.nextUrl.searchParams
    const bearer = extractBearerToken(request.headers.get('Authorization')) ?? ''
    const managementKey = isManagementKeyToken(bearer)
    const ctx = await validateMcpAuth(
      request,
      managementKey ? { deferManagementPermissionCheck: true } : undefined,
    )
    if (!ctx) {
      if (managementKey) return usageUnauthorized()
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
        { status: 401 }
      )
    }

    if (managementKey) {
      const managementPermissions = ctx.management?.permissions ?? {}
      if (
        !searchParams.has('project_id') &&
        hasUsageReadPermission(managementPermissions)
      ) {
        return getTeamUsage(ctx, request)
      }
      // A key without usage read may use the project-scoped route only when it
      // also has data permission. Usage-only keys must never fall through to
      // that broader data surface.
      if (!hasDataPermission(managementPermissions)) {
        return usageUnauthorized()
      }
    }

    const sp = searchParams
    const projectId = Number(sp.get('project_id'))
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      return validationError('project_id is required', 'project_id')
    }

    const groupBy = (sp.get('group_by') ?? 'model') as GroupBy
    if (!GROUPS.includes(groupBy)) {
      return validationError(`group_by must be one of ${GROUPS.join(', ')}`, 'group_by')
    }

    let since: Date | undefined
    const sinceRaw = sp.get('since')
    if (sinceRaw) {
      const d = new Date(sinceRaw)
      if (Number.isNaN(d.getTime())) return validationError('since must be an ISO date', 'since')
      since = d
    }

    // Access-scope: only report a board the caller can see.
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...getProjectWhere(ctx.user.id, ctx.agentId) },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found or access denied' },
        { status: 404 }
      )
    }

    // Aggregate token totals grouped by the requested dimension only.
    // A dynamic `by` defeats Prisma's precise groupBy inference, so type the
    // args and result explicitly. groupBy is whitelisted against GROUPS above.
    type UsageRow = {
      _sum: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
      _count: { _all: number }
    } & Record<string, string | number | null>
    const groupField = DB_FIELD[groupBy]
    const groupByFn = prisma.aiUsage.groupBy as (args: unknown) => Promise<unknown>
    const rows = (await groupByFn({
      by: [groupField],
      where: { projectId, ...(since ? { createdAt: { gte: since } } : {}) },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      _count: { _all: true },
    })) as UsageRow[]

    const groups = rows
      .map((r) => ({
        key: (r as Record<string, unknown>)[groupField] as string | number,
        requests: r._count._all,
        inputTokens: r._sum.inputTokens ?? 0,
        outputTokens: r._sum.outputTokens ?? 0,
        totalTokens: r._sum.totalTokens ?? 0,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens)

    const totalTokens = groups.reduce((sum, g) => sum + g.totalTokens, 0)

    return NextResponse.json({
      success: true,
      projectId,
      groupBy,
      totalTokens,
      groups,
    })
  } catch (error) {
    console.error('[MCP AI Usage] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
