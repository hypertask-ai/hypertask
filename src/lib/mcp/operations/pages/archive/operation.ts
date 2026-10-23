import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { standalonePagesEnabled } from '@/utils/controllers/pages/standalonePagesEnabled'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { requireRole } from '@/lib/mcp/agents/scopes'
import { buildFieldError } from '@/lib/mcp/fieldError'
import {
  archivePage,
  getPage,
} from '@/utils/controllers/pages/pageService'
import {
  canAccessProject,
  isRequestBody,
  resolvePageIdentifierAlias,
} from '@/lib/mcp/operations/pages/helpers'

type ArchivePageBody = {
  id?: unknown
  page_id?: unknown
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  let identifierField: 'id' | 'page_id' = 'id'

  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (ctx.agentId) {
      const scopeError = await requireRole(ctx, 'write')
      if (scopeError) return scopeError
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch {
      return NextResponse.json(
        buildFieldError('invalid_field', 'body', 'Request body must be valid JSON'),
        { status: 400 }
      )
    }
    if (!isRequestBody(parsedBody)) {
      return NextResponse.json(
        buildFieldError('invalid_field', 'body', 'Request body must be a JSON object'),
        { status: 400 }
      )
    }
    const body = parsedBody as ArchivePageBody

    const identifierResult = resolvePageIdentifierAlias(body)
    if ('error' in identifierResult) {
      return NextResponse.json(
        identifierResult.error,
        { status: 400 }
      )
    }
    const { identifier } = identifierResult
    identifierField = identifierResult.field

    const existingPage = await getPage({ ...identifier, userId: ctx.user.id, standalonePagesEnabled: await standalonePagesEnabled(ctx.user.id), agentId: ctx.agentId, teamScope: ctx.teamScope })
    if (
      !existingPage ||
      !(await canAccessProject(existingPage.projectId, ctx))
    ) {
      return NextResponse.json(
        buildFieldError('not_found', identifierField, 'Page not found'),
        { status: 404 }
      )
    }

    await archivePage({
      id: existingPage.id,
      userId: ctx.user.id,
      agentId: ctx.agentId, teamScope: ctx.teamScope,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        buildFieldError('not_found', identifierField, 'Page not found'),
        { status: 404 }
      )
    }

    console.error('[MCP Archive Page] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}
