import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { getPage, listPageVersions } from '@/utils/controllers/pages/pageService'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

type RouteContext = { params: Promise<{ publicId: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const userCookie = (await cookies()).get('nookies_user')
    if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { isValid, user } = isValidUser(userCookie.value)
    if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = user.id

    const { publicId } = await params
    const page = await getPage({ publicId })
    if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

    const task = await prisma.task.findFirst({
      where: {
        id: page.taskId,
        project: {
          status: 'Normal',
          ...getProjectWhere(userId, null),
        },
      },
      select: { id: true },
    })
    if (!task) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

    const versions = (await listPageVersions({ pageId: page.id })).map((version) => ({
      id: version.id,
      version: version.version,
      note: version.note,
      authorId: version.authorId,
      agentId: version.agentId,
      createdAt: version.createdAt,
    }))

    return NextResponse.json({ versions })
  } catch (error) {
    console.error('[List Page Versions] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
