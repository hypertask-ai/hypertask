import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { updateTaskSingle } from '@/utils/controllers/tasks/single'
import { broadcastBoardChange, broadcastTaskChange } from '@/lib/realtime/server'

type RouteContext = { params: Promise<{ taskId: string }> }
type RestoreDescriptionBody = { version_id?: unknown }

function parseTaskId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null

  const taskId = Number(value)
  return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null
}

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

    const taskId = parseTaskId((await params).taskId)
    if (taskId === null) {
      return NextResponse.json({ error: 'taskId must be a positive integer' }, { status: 400 })
    }

    let parsedBody: unknown
    try {
      parsedBody = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
    }
    if (!isRequestBody(parsedBody)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    const body = parsedBody as RestoreDescriptionBody

    const versionId = positiveInteger(body.version_id)
    if (versionId === null) {
      return NextResponse.json({ error: 'version_id must be a positive integer' }, { status: 400 })
    }

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          status: 'Normal',
          ...getProjectWhere(userId, null),
        },
      },
      select: {
        id: true,
        projectId: true,
        description_: { select: { content: true } },
      },
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const snapshot = await prisma.docVersion.findFirst({
      where: {
        id: versionId,
        entityType: 'task_description',
        entityId: taskId,
      },
      select: { contentHtml: true, version: true },
    })
    if (!snapshot) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    }
    if (snapshot.contentHtml === (task.description_?.content ?? '')) {
      return NextResponse.json(
        { error: 'This version already matches the current description' },
        { status: 409 },
      )
    }

    const result = await updateTaskSingle(
      { id: taskId, description: snapshot.contentHtml },
      user,
      undefined,
      { expectedDescription: task.description_?.content ?? '' },
    )
    if (result.status !== 200) {
      return NextResponse.json(
        { error: result.json?.message ?? 'Unable to restore description' },
        { status: result.status },
      )
    }
    void broadcastBoardChange(task.projectId, { originUserId: userId })
    void broadcastTaskChange(taskId, { originUserId: userId })

    return NextResponse.json({
      ok: true,
      restored_from_version: snapshot.version,
    })
  } catch (error) {
    console.error('[Restore Task Description] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
