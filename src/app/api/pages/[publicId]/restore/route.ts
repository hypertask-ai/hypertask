import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { getPage, restorePageVersion } from '@/utils/controllers/pages/pageService'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

type RouteContext = { params: Promise<{ publicId: string }> }
type RestorePageBody = { version_id?: unknown }

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(request: NextRequest, { params }: RouteContext) {
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
    const body = parsedBody as RestorePageBody

    const versionId = positiveInteger(body.version_id)
    if (versionId === null) {
      return NextResponse.json({ error: 'version_id must be a positive integer' }, { status: 400 })
    }

    const { publicId } = await params
    const existingPage = await getPage({ publicId })
    if (!existingPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    const task = await prisma.task.findFirst({
      where: {
        id: existingPage.taskId,
        project: {
          status: 'Normal',
          ...getProjectWhere(userId, null),
        },
      },
      select: { id: true },
    })
    if (!task) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

    try {
      const page = await restorePageVersion({
        pageId: existingPage.id,
        versionId,
        userId,
        agentId: null,
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
        return NextResponse.json({ error: 'Version not found' }, { status: 404 })
      }
      throw error
    }
  } catch (error) {
    console.error('[Restore Page Version] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
