import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { standalonePagesEnabled } from '@/utils/controllers/pages/standalonePagesEnabled'
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from 'next/server'

import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import {
  getPage,
  listPageVersions,
} from '@/utils/controllers/pages/pageService'
import {
  canAccessProject,
  resolvePageIdentifierAlias,
} from '@/lib/mcp/operations/pages/helpers'

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const identifierResult = resolvePageIdentifierAlias(
      request.nextUrl.searchParams
    )
    if ('error' in identifierResult) {
      return NextResponse.json(
        identifierResult.error,
        { status: 400 }
      )
    }
    const { identifier, field: identifierField } = identifierResult

    const page = await getPage({ ...identifier, userId: ctx.user.id, standalonePagesEnabled: await standalonePagesEnabled(ctx.user.id), agentId: ctx.agentId })
    if (!page || !(await canAccessProject(page.projectId, ctx))) {
      return NextResponse.json(
        buildFieldError('not_found', identifierField, 'Page not found'),
        { status: 404 }
      )
    }

    const versions = (await listPageVersions({ pageId: page.id })).map(
      (version) => ({
        id: version.id,
        version: version.version,
        title: version.title,
        note: version.note,
        authorId: version.authorId,
        agentId: version.agentId,
        createdAt: version.createdAt,
      })
    )

    return NextResponse.json({ versions })
  } catch (error) {
    console.error('[MCP List Page Versions] Error:', error)
    reportMcpOperationCrash(request, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  })(request)
}
