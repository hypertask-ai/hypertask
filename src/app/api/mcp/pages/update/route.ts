import { NextRequest, NextResponse } from 'next/server'

import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { htmlToMarkdown } from '@/utils/controllers/pages/htmlToMarkdown'
import {
  getPage,
  PageConflictError,
  type PageContentType,
  type PageUpdateMode,
  updatePage,
} from '@/utils/controllers/pages/pageService'
import {
  canAccessProject,
  getPageUrl,
  isRequestBody,
  parsePositiveInteger,
  resolvePageIdentifierAlias,
} from '../_lib/routeUtils'

type UpdatePageBody = {
  id?: unknown
  page_id?: unknown
  content?: unknown
  content_type?: unknown
  mode?: unknown
  if_version?: unknown
  note?: unknown
  title?: unknown
}

const PAGE_TITLE_MAX_LENGTH = 500
const CONTENT_TYPES = ['markdown', 'html', 'html_canvas'] as const
const UPDATE_MODES = ['replace', 'append', 'prepend'] as const

export async function POST(request: NextRequest) {
  let identifierField: 'id' | 'page_id' = 'id'

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
    const body = parsedBody as UpdatePageBody

    const identifierResult = resolvePageIdentifierAlias(body)
    if ('error' in identifierResult) {
      return NextResponse.json(
        identifierResult.error,
        { status: 400 }
      )
    }
    const { identifier } = identifierResult
    identifierField = identifierResult.field

    const hasTitle = body.title !== undefined
    const hasContent = body.content !== undefined

    if (!hasTitle && !hasContent) {
      return NextResponse.json(
        buildFieldError('missing_field', 'title', 'title or content must be provided'),
        { status: 400 }
      )
    }

    if (
      hasTitle &&
      (typeof body.title !== 'string' ||
        body.title.trim().length === 0 ||
        body.title.length > PAGE_TITLE_MAX_LENGTH)
    ) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'title',
          `title must be a non-empty string of at most ${PAGE_TITLE_MAX_LENGTH} characters`
        ),
        { status: 400 }
      )
    }

    if (hasContent && typeof body.content !== 'string') {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'content',
          'content must be a string'
        ),
        { status: 400 }
      )
    }

    const contentType = body.content_type ?? 'markdown'
    if (hasContent && !CONTENT_TYPES.includes(contentType as PageContentType)) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'content_type',
          'Invalid content_type. Must be one of: markdown, html',
          CONTENT_TYPES
        ),
        { status: 400 }
      )
    }

    const mode = body.mode ?? 'replace'
    if (hasContent && !UPDATE_MODES.includes(mode as PageUpdateMode)) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'mode',
          'Invalid mode. Must be one of: replace, append, prepend',
          UPDATE_MODES
        ),
        { status: 400 }
      )
    }

    let ifVersion: number | undefined
    if (body.if_version !== undefined) {
      const parsedVersion = parsePositiveInteger(body.if_version)
      if (parsedVersion === null) {
        return NextResponse.json(
          buildFieldError(
            'invalid_field',
            'if_version',
            'if_version must be a positive integer'
          ),
          { status: 400 }
        )
      }
      ifVersion = parsedVersion
    }

    if (body.note !== undefined && typeof body.note !== 'string') {
      return NextResponse.json(
        buildFieldError('invalid_field', 'note', 'note must be a string'),
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
      const page = await updatePage({
        id: existingPage.id,
        title: typeof body.title === 'string' ? body.title.trim() : undefined,
        content: body.content as string | undefined,
        contentType: hasContent ? contentType as PageContentType : undefined,
        mode: mode as PageUpdateMode,
        ifVersion,
        note: body.note as string | undefined,
        userId: ctx.user.id,
        agentId: ctx.agentId,
      })

      return NextResponse.json({
        page: {
          publicId: page.publicId,
          id: page.id,
          title: page.title,
          version: page.version,
          url: getPageUrl(page.publicId),
        },
      })
    } catch (error) {
      if (error instanceof PageConflictError) {
        return NextResponse.json(
          {
            error: 'version_conflict',
            current_version: error.currentVersion,
            current_content: htmlToMarkdown(error.currentContent.html),
          },
          { status: 409 }
        )
      }
      throw error
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        buildFieldError('not_found', identifierField, 'Page not found'),
        { status: 404 }
      )
    }

    console.error('[MCP Update Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
