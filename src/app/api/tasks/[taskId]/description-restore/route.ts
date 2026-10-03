import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { jsonError, unauthorized } from '@/lib/api/response'
import { readJsonBody } from '@/lib/mcp/readJsonBody'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { taskAccessWhere } from '@/utils/controllers/tasks/assertTaskAccess'
import { updateTaskSingle } from '@/utils/controllers/tasks/single'
import { broadcastBoardChange, broadcastTaskChange } from '@/lib/realtime/server'

type RouteContext = { params: Promise<{ taskId: string }> }
type RestoreDescriptionBody = { version_id?: unknown }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true)
    if (!currentUser) return unauthorized()
    const { userId, user } = currentUser

    const taskId = parsePositiveInt((await params).taskId)
    if (taskId === null) {
      return jsonError('taskId must be a positive integer', 400)
    }

    const parsed = await readJsonBody<RestoreDescriptionBody>(request, {
      invalidJson: () => jsonError('Request body must be valid JSON'),
      invalidObject: () => jsonError('Request body must be a JSON object'),
    })
    if (!parsed.ok) return parsed.response

    // Preserve the legacy numeric version range; task path IDs remain safe integers.
    const versionId = typeof parsed.body.version_id === 'number'
      ? parsePositiveInt(parsed.body.version_id, { safe: false, max: Infinity })
      : null
    if (versionId === null) {
      return jsonError('version_id must be a positive integer', 400)
    }

    const task = await prisma.task.findFirst({
      where: taskAccessWhere(userId, taskId, { projectStatus: 'Normal' }),
      select: {
        id: true,
        projectId: true,
        description_: { select: { content: true } },
      },
    })
    if (!task) return jsonError('Task not found', 404)

    const snapshot = await prisma.docVersion.findFirst({
      where: {
        id: versionId,
        entityType: 'task_description',
        entityId: taskId,
      },
      select: { contentHtml: true, version: true },
    })
    if (!snapshot) {
      return jsonError('Version not found', 404)
    }
    if (snapshot.contentHtml === (task.description_?.content ?? '')) {
      return jsonError('This version already matches the current description', 409)
    }

    const result = await updateTaskSingle(
      { id: taskId, description: snapshot.contentHtml },
      user,
      undefined,
      { expectedDescription: task.description_?.content ?? '' },
    )
    if (result.status !== 200) {
      return jsonError(result.json?.message ?? 'Unable to restore description', result.status)
    }
    void broadcastBoardChange(task.projectId, { originUserId: userId })
    void broadcastTaskChange(taskId, { originUserId: userId })

    return NextResponse.json({
      ok: true,
      restored_from_version: snapshot.version,
    })
  } catch (error) {
    console.error('[Restore Task Description] Error:', error)
    return jsonError('Internal server error', 500)
  }
}
