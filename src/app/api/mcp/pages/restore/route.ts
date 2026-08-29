import { NextRequest, NextResponse } from 'next/server'

import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import {
  getPage,
  restorePageVersion,
} from '@/utils/controllers/pages/pageService'
import {
  canAccessProject,
  isRequestBody,
  parsePositiveInteger,
  resolvePageIdentifierAlias,
} from '../_lib/routeUtils'

type RestorePageBody = {
  id?: unknown
  page_id?: unknown
  version_id?: unknown
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const body = parsedBody as RestorePageBody

    const identifierResult = resolvePageIdentifierAlias(body)
    if ('error' in identifierResult) {
      return NextResponse.json(
        identifierResult.error,
        { status: 400 }
      )
    }
    const { identifier, field: identifierField } = identifierResult

    const versionId = parsePositiveInteger(body.version_id)
    if (versionId === null) {
      return NextResponse.json(
        buildFieldError(
          body.version_id === undefined ? 'missing_field' : 'invalid_field',
          'version_id',
          'version_id must be a positive integer'
        ),
        { status: 400 }
      )
    }

    const existingPage = await getPage(identifier)
    if (
      !existingPage ||
      !(await canAccessProject(existingPage.projectId, ctx))
    ) {
      return NextResponse.json(
        buildFieldError('not_found', identifierField, 'Page not found'),
        { status: 404 }
      )
    }

    try {
      const page = await restorePageVersion({
        pageId: existingPage.id,
        versionId,
        userId: ctx.user.id,
        agentId: ctx.agentId,
      })

      return NextResponse.json({
        page: {
          publicId: page.publicId,
          id: page.id,
          version: page.version,
        },
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        const field = error.message.startsWith('Page version')
          ? 'version_id'
          : identifierField
        return NextResponse.json(
          buildFieldError('not_found', field, error.message),
          { status: 404 }
        )
      }
      throw error
    }
  } catch (error) {
    console.error('[MCP Restore Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
