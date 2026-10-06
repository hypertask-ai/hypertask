import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import {
  createPage,
  type PageContentType,
} from '@/utils/controllers/pages/pageService'

type CreatePageBody = {
  task_id?: unknown
  title?: unknown
  content?: unknown
  content_type?: unknown
  parent_page_id?: unknown
}

const CONTENT_TYPES = ['markdown', 'html', 'html_canvas'] as const

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)
    let restCompat = false
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId)
      } catch {
        // A failed flag probe must leave the legacy HTTP contract unchanged.
      }
    }

    let userId: number
    if (restCompat && currentUser) {
      userId = currentUser.userId
    } else {
      const userCookie = (await cookies()).get('nookies_user')
      if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const { isValid, user } = isValidUser(userCookie.value)
      if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = user.id
    }

    let parsedBody: unknown
    if (restCompat) {
      const result = await readJsonBody<Record<string, unknown>>(request, {
        invalidJson: () => NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
        invalidObject: () => NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }),
      })
      if (!result.ok) return result.response
      parsedBody = result.body
    } else {
      try {
        parsedBody = await request.json()
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
      }
      if (!isRequestBody(parsedBody)) {
        return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
      }
    }
    const body = parsedBody as CreatePageBody

    const taskId = restCompat
      ? (typeof body.task_id === 'number' ? parsePositiveInt(body.task_id, { safe: false, max: Infinity }) : null)
      : positiveInteger(body.task_id)
    if (taskId === null) {
      return NextResponse.json({ error: 'task_id must be a positive integer' }, { status: 400 })
    }
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title must be a string' }, { status: 400 })
    }

    const contentType = body.content_type ?? 'html'
    if (!CONTENT_TYPES.includes(contentType as PageContentType)) {
      return NextResponse.json(
        { error: 'content_type must be one of: markdown, html' },
        { status: 400 }
      )
    }

    let parentPageId: number | undefined
    if (body.parent_page_id !== undefined) {
      const parsedParentPageId = restCompat
        ? (typeof body.parent_page_id === 'number' ? parsePositiveInt(body.parent_page_id, { safe: false, max: Infinity }) : null)
        : positiveInteger(body.parent_page_id)
      if (parsedParentPageId === null) {
        return NextResponse.json(
          { error: 'parent_page_id must be a positive integer' },
          { status: 400 }
        )
      }
      parentPageId = parsedParentPageId
    }

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          status: 'Normal',
          ...getProjectWhere(userId, null),
        },
      },
      select: { id: true },
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const page = await createPage({
      taskId,
      title: body.title as string | undefined,
      content: body.content,
      contentType: contentType as PageContentType,
      parentPageId,
      userId,
      agentId: null,
    })

    return NextResponse.json({
      page: {
        publicId: page.publicId,
        id: page.id,
        title: page.title,
        version: page.version,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    console.error('[Create Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
