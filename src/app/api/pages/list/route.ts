import { standalonePagesEnabled } from '@/utils/controllers/pages/standalonePagesEnabled'
import { checkRestRateLimit } from '@/lib/api/rateLimit'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7298_STANDALONE_PAGES_FLAG } from '@/lib/flags/definitions/htpr-7298-standalone-pages'
import { listPages } from '@/utils/controllers/pages/pageService'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

function parseTaskId(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null

  const taskId = Number(value)
  return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)

    let userId: number
    if (currentUser) {
      userId = currentUser.userId
    } else {
      const userCookie = (await cookies()).get('nookies_user')
      if (!userCookie?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const { isValid, user } = isValidUser(userCookie.value)
      if (!isValid || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = user.id
    }

    if (currentUser) {
      const limited = await checkRestRateLimit(currentUser.userId, 'read')
      if (limited) return limited
    }

    const scope = request.nextUrl.searchParams.get('scope')
    if (scope !== null) {
      if (!(await isFeatureEnabled(HTPR_7298_STANDALONE_PAGES_FLAG, userId))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (scope !== 'all' && scope !== 'board') {
        return NextResponse.json({ error: 'scope must be all or board' }, { status: 400 })
      }
      const projectId = parseTaskId(request.nextUrl.searchParams.get('project_id'))
      if (scope === 'board' && projectId === null) {
        return NextResponse.json({ error: 'project_id must be a positive integer' }, { status: 400 })
      }
      const archived = request.nextUrl.searchParams.get('archived') ?? '0'
      if (archived !== '0' && archived !== '1') {
        return NextResponse.json({ error: 'archived must be 0 or 1' }, { status: 400 })
      }
      const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
      if (query.length > 200) {
        return NextResponse.json({ error: 'q must be 200 characters or less' }, { status: 400 })
      }
      const pages = await listPages({
        ...(scope === 'board' ? { projectId: projectId! } : {}),
        userId,
        standalonePagesEnabled: true,
        agentId: null,
        archived: archived === '1',
        query,
      })
      return NextResponse.json({ pages, count: pages.length })
    }

    const taskId = parsePositiveInt(request.nextUrl.searchParams.get('task_id'))
    if (taskId === null) {
      return NextResponse.json({ error: 'task_id must be a positive integer' }, { status: 400 })
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

    const pages = (await listPages({ taskId, userId, standalonePagesEnabled: await standalonePagesEnabled(userId), agentId: null })).map((page) => ({
      publicId: page.publicId,
      id: page.id,
      title: page.title,
      parentPageId: page.parentPageId,
      updatedAt: page.updatedAt,
    }))

    return NextResponse.json({ pages })
  } catch (error) {
    console.error('[List Pages] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
