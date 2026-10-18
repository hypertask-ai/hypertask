import { checkRestRateLimit } from '@/lib/api/rateLimit'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import { loadCurrentUser } from '@/lib/auth/currentUser'
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from '@/lib/flags'
import { HTPR_7298_STANDALONE_PAGES_FLAG } from '@/lib/flags/definitions/htpr-7298-standalone-pages'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import prisma from '@/lib/prisma'
import { taskWriteAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import { isValidUser } from '@/utils/edgeHelpers'

type RouteContext = { params: Promise<{ publicId: string }> }

async function changeLink(request: NextRequest, { params }: RouteContext, remove: boolean) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null)
    let restCompat = false
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId)
      } catch {
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

    if (!(await isFeatureEnabled(HTPR_7298_STANDALONE_PAGES_FLAG, userId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (restCompat && currentUser) {
      const limited = await checkRestRateLimit(currentUser.userId, 'write')
      if (limited) return limited
    }

    const result = await readJsonBody<Record<string, unknown>>(request, {
      invalidJson: () => NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
      invalidObject: () => NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 }),
    })
    if (!result.ok) return result.response
    const taskId = typeof result.body.task_id === 'number'
      ? parsePositiveInt(result.body.task_id)
      : null
    if (taskId === null) {
      return NextResponse.json({ error: 'task_id must be a positive integer' }, { status: 400 })
    }

    const { publicId } = await params
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Page" WHERE "publicId" = ${publicId} FOR UPDATE`
      const page = await tx.page.findFirst({
        where: {
          publicId,
          project: { status: 'Normal', ...taskWriteAccessWhere(userId, null) },
        },
        select: { id: true, taskId: true, project: { select: { teamId: true } } },
      })
      if (!page) return { error: 'Page not found', status: 404 }

      if (remove) {
        await tx.pageTaskLink.deleteMany({ where: { pageId: page.id, taskId } })
      } else {
        const task = await tx.task.findFirst({
          where: {
            id: taskId,
            status: { not: 'Deleted' },
            project: { status: 'Normal', ...taskWriteAccessWhere(userId, null) },
          },
          select: { id: true, project: { select: { teamId: true } } },
        })
        if (!task) return { error: 'Task not found', status: 404 }
        if (!page.project.teamId || page.project.teamId !== task.project.teamId) {
          return { error: 'Boards must belong to the same team', status: 403 }
        }
        await tx.pageTaskLink.upsert({
          where: { pageId_taskId: { pageId: page.id, taskId } },
          create: { pageId: page.id, taskId, createdById: userId },
          update: {},
        })
        if (page.taskId === null) {
          await tx.page.update({ where: { id: page.id }, data: { taskId } })
        }
      }
      return null
    })
    if (outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Page Link] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  return changeLink(request, context, false)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return changeLink(request, context, true)
}
