import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { searchPages } from '@/utils/controllers/pages/pageService'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

const MAX_QUERY_LENGTH = 200
const SNIPPET_LENGTH = 200

export async function GET(request: NextRequest) {
  try {
    const userCookie = (await cookies()).get('nookies_user')
    if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { isValid, user } = isValidUser(userCookie.value)
    if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = user.id

    const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (!query) {
      return NextResponse.json({ error: 'Search query q is required' }, { status: 400 })
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Search query must be ${MAX_QUERY_LENGTH} characters or less` },
        { status: 400 }
      )
    }

    const projects = await prisma.project.findMany({
      where: {
        status: 'Normal',
        ...getProjectWhere(userId, null),
      },
      select: { id: true },
    })

    const matches = await searchPages({
      query,
      projectIds: projects.map((project) => project.id),
    })
    const pages = matches.map((page) => ({
      publicId: page.publicId,
      id: page.id,
      title: page.title,
      taskId: page.taskId,
      snippet: page.contentText.slice(0, SNIPPET_LENGTH),
      updatedAt: page.updatedAt,
    }))

    return NextResponse.json({ pages })
  } catch (error) {
    console.error('[Search Pages] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
