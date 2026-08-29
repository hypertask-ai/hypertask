import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import {
  getPage,
  PageConflictError,
  type PageContentType,
  type PageUpdateMode,
  updatePage,
} from '@/utils/controllers/pages/pageService'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

type RouteContext = { params: Promise<{ publicId: string }> }

type UpdatePageBody = {
  title?: unknown
  content?: unknown
  content_type?: unknown
  mode?: unknown
  if_version?: unknown
  note?: unknown
}

const CONTENT_TYPES = ['markdown', 'html', 'html_canvas'] as const
const UPDATE_MODES = ['replace', 'append', 'prepend'] as const

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function canAccessTask(taskId: number, userId: number) {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      project: {
        status: 'Normal',
        ...getProjectWhere(userId, null),
      },
    },
    select: { id: true },
  })
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const userCookie = (await cookies()).get('nookies_user')
    if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { isValid, user } = isValidUser(userCookie.value)
    if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = user.id

    const { publicId } = await params
    const page = await getPage({ publicId })
    if (!page || !(await canAccessTask(page.taskId, userId))) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    return NextResponse.json({
      page: {
        publicId: page.publicId,
        id: page.id,
        title: page.title,
        contentHtml: page.contentHtml,
        version: page.version,
        taskId: page.taskId,
        subPages: page.subPages,
        updatedAt: page.updatedAt,
      },
    })
  } catch (error) {
    console.error('[Get Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const userCookie = (await cookies()).get('nookies_user')
    if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { isValid, user } = isValidUser(userCookie.value)
    if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = user.id

    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }
    if (!isRequestBody(parsedBody)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    const body = parsedBody as UpdatePageBody

    const hasTitle = body.title !== undefined
    const hasContent = body.content !== undefined

    if (!hasTitle && !hasContent) {
      return NextResponse.json(
        { error: 'title or content must be provided' },
        { status: 400 }
      )
    }

    if (hasTitle && typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title must be a string' }, { status: 400 })
    }

    if (hasContent && typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    const contentType = body.content_type ?? 'html'
    if (hasContent && !CONTENT_TYPES.includes(contentType as PageContentType)) {
      return NextResponse.json(
        { error: 'content_type must be one of: markdown, html' },
        { status: 400 }
      )
    }

    const mode = body.mode ?? 'replace'
    if (hasContent && !UPDATE_MODES.includes(mode as PageUpdateMode)) {
      return NextResponse.json(
        { error: 'mode must be one of: replace, append, prepend' },
        { status: 400 }
      )
    }

    let ifVersion: number | undefined
    if (hasContent && body.if_version !== undefined) {
      const parsedVersion = positiveInteger(body.if_version)
      if (parsedVersion === null) {
        return NextResponse.json(
          { error: 'if_version must be a positive integer' },
          { status: 400 }
        )
      }
      ifVersion = parsedVersion
    }

    if (hasContent && body.note !== undefined && typeof body.note !== 'string') {
      return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
    }

    const { publicId } = await params
    const existingPage = await getPage({ publicId })
    if (!existingPage || !(await canAccessTask(existingPage.taskId, userId))) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    try {
      let page = {
        publicId: existingPage.publicId,
        id: existingPage.id,
        version: existingPage.version,
      }

      if (hasTitle) {
        page = await prisma.page.update({
          where: { id: existingPage.id },
          data: { title: body.title as string },
          select: { publicId: true, id: true, version: true },
        })
      }

      if (hasContent) {
        page = await updatePage({
          id: existingPage.id,
          content: body.content as string,
          contentType: contentType as PageContentType,
          mode: mode as PageUpdateMode,
          ifVersion,
          note: body.note as string | undefined,
          userId,
          agentId: null,
        })
      }

      return NextResponse.json({
        page: {
          publicId: page.publicId,
          id: page.id,
          version: page.version,
        },
      })
    } catch (error) {
      if (error instanceof PageConflictError) {
        return NextResponse.json(
          {
            error: 'version_conflict',
            current_version: error.currentVersion,
            current_html: error.currentContent.html,
          },
          { status: 409 }
        )
      }
      throw error
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    console.error('[Update Page] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
