import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { searchPages } from '@/utils/controllers/pages/pageService'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

const MAX_QUERY_LENGTH = 200
const SNIPPET_LENGTH = 200

export async function GET(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const rawQuery = request.nextUrl.searchParams.get('q')
    const query = rawQuery?.trim() ?? ''
    if (!query) {
      return NextResponse.json(
        buildFieldError('missing_field', 'q', 'Search query q is required'),
        { status: 400 }
      )
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        buildFieldError(
          'invalid_field',
          'q',
          `Search query must be ${MAX_QUERY_LENGTH} characters or less`
        ),
        { status: 400 }
      )
    }

    const projects = await prisma.project.findMany({
      where: {
        status: 'Normal',
        ...getProjectWhere(ctx.user.id, ctx.agentId),
      },
      select: { id: true },
    })

    const matches = await searchPages({
      query,
      projectIds: projects.map((project) => project.id),
    })

    const pages = matches.map(({ contentText, ...page }) => ({
      ...page,
      snippet: contentText.trim().slice(0, SNIPPET_LENGTH),
    }))

    return NextResponse.json({ pages })
  } catch (error) {
    console.error('[MCP Search Pages] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
