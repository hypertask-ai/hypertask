import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { htmlToMarkdown } from '@/utils/controllers/pages/htmlToMarkdown'
import { decodeHtmlCanvas } from '@/utils/controllers/pages/htmlCanvas'
import { getPage } from '@/utils/controllers/pages/pageService'
import {
  canAccessProject,
  resolvePageIdentifierAlias,
} from '../_lib/routeUtils'

const FORMATS = ['markdown', 'html'] as const

export async function GET(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const searchParams = request.nextUrl.searchParams
    const identifierResult = resolvePageIdentifierAlias(searchParams)
    if ('error' in identifierResult) {
      return NextResponse.json(
        identifierResult.error,
        { status: 400 }
      )
    }
    const { identifier, field: identifierField } = identifierResult

    const format = searchParams.get('format') ?? 'markdown'
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'format',
          'Invalid format. Must be one of: markdown, html',
          FORMATS
        ),
        { status: 400 }
      )
    }

    const page = await getPage(identifier)
    if (!page || !(await canAccessProject(page.projectId, ctx))) {
      return NextResponse.json(
        buildFieldError('not_found', identifierField, 'Page not found'),
        { status: 404 }
      )
    }

    // Canvas pages round-trip as the raw HTML the agent wrote, regardless of the
    // requested format (markdown of an opaque block would be meaningless).
    const canvas = decodeHtmlCanvas(page.contentHtml)
    const content = canvas != null
      ? canvas
      : format === 'html'
        ? page.contentHtml
        : htmlToMarkdown(page.contentHtml)
    const responseFormat = canvas != null ? 'html_canvas' : format

    return NextResponse.json({
      page: {
        publicId: page.publicId,
        id: page.id,
        title: page.title,
        version: page.version,
        content,
        content_type: responseFormat,
        task: {
          id: page.task.id,
          ticketNumber: page.task.ticketNumber,
          title: page.task.title,
          projectId: page.task.projectId,
          uniqueIndex: page.task.uniqueIndex,
        },
        subPages: page.subPages,
        updatedAt: page.updatedAt,
      },
    })
  } catch (error) {
    console.error('[MCP Get Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
