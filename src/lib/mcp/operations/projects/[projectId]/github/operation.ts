import { NextRequest, NextResponse } from 'next/server'

import { requireAgentWriteRole } from '@/lib/mcp/agents/readRoleGuard'
import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG } from '@/lib/flags/definitions/htpr-7515-connect-github-per-board'
import { HTPR_8951_BOARD_GITHUB_REPOS_FLAG } from '@/lib/flags/definitions/htpr-8951-board-github-repos'
import {
  BoardGithubSettingsError,
  getBoardGithubSettings,
  saveBoardGithubRepositories,
} from '@/lib/github/boardRepositories'

function unauthorized() {
  return NextResponse.json(
    { success: false, error: 'Unauthorized. Invalid or missing authentication token.' },
    { status: 401 }
  )
}

function parseProjectId(raw: string): number | null {
  const id = parseInt(raw, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function flagRefusal(userId: number) {
  const off = NextResponse.json({ success: false, error: 'not_found' }, { status: 404 })
  if (!await isFeatureEnabled(HTPR_8951_BOARD_GITHUB_REPOS_FLAG, userId)) return off
  if (!await isFeatureEnabled(HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG, userId)) return off
  return null
}

function settingsRefusal(error: BoardGithubSettingsError) {
  return NextResponse.json({
    success: false,
    error: error.error,
    ...(error.repositoryIds ? { repositoryIds: error.repositoryIds } : {}),
  }, { status: error.status })
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
    const { projectId: rawId } = await props.params
    try {
      const rateLimited = await checkMcpRateLimit(request)
      if (rateLimited) return rateLimited
      const ctx = await validateMcpAuth(request)
      if (!ctx) return unauthorized()

      const refusal = await flagRefusal(ctx.user.id)
      if (refusal) return refusal

      const projectId = parseProjectId(rawId)
      if (projectId === null) {
        return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 })
      }

      const settings = await getBoardGithubSettings(ctx.user.id, projectId)
      return NextResponse.json({ success: true, ...settings })
    } catch (error) {
      if (error instanceof BoardGithubSettingsError) return settingsRefusal(error)
      console.error('[MCP Board GitHub] GET Error:', error)
      reportMcpOperationCrash(request, error)
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  })(request)
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  return wrapMcpRoute(async (request: NextRequest) => {
    const { projectId: rawId } = await props.params
    try {
      const rateLimited = await checkMcpRateLimit(request)
      if (rateLimited) return rateLimited
      const ctx = await validateMcpAuth(request)
      if (!ctx) return unauthorized()
      const roleRefusal = await requireAgentWriteRole(ctx)
      if (roleRefusal) return roleRefusal

      const refusal = await flagRefusal(ctx.user.id)
      if (refusal) return refusal

      const projectId = parseProjectId(rawId)
      if (projectId === null) {
        return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 })
      }

      const settings = await saveBoardGithubRepositories(ctx.user.id, projectId, body)
      return NextResponse.json({ success: true, ...settings })
    } catch (error) {
      if (error instanceof BoardGithubSettingsError) return settingsRefusal(error)
      console.error('[MCP Board GitHub] PUT Error:', error)
      reportMcpOperationCrash(request, error)
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  })(request)
}
