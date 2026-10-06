import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
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

    const taskId = restCompat
      ? parsePositiveInt(request.nextUrl.searchParams.get('task_id'))
      : parseTaskId(request.nextUrl.searchParams.get('task_id'))
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

    const pages = (await listPages({ taskId })).map((page) => ({
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
