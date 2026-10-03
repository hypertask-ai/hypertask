import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { loadCurrentUser } from '@/lib/auth/currentUser'
import { jsonError, unauthorized } from '@/lib/api/response'
import { parsePositiveInt } from '@/lib/parsePositiveInt'
import { taskAccessWhere } from '@/utils/controllers/tasks/assertTaskAccess'

type RouteContext = { params: Promise<{ taskId: string }> }
const MAX_DESCRIPTION_VERSIONS = 100

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const currentUser = await loadCurrentUser(_request.headers, true)
    if (!currentUser) return unauthorized()
    const { userId } = currentUser

    const taskId = parsePositiveInt((await params).taskId)
    if (taskId === null) {
      return jsonError('taskId must be a positive integer', 400)
    }

    const task = await prisma.task.findFirst({
      where: taskAccessWhere(userId, taskId, { projectStatus: 'Normal' }),
      select: {
        id: true,
        description_: { select: { content: true } },
      },
    })
    if (!task) return jsonError('Task not found', 404)

    const versionRows = await prisma.docVersion.findMany({
      where: { entityType: 'task_description', entityId: taskId },
      orderBy: [{ version: 'desc' }],
      take: MAX_DESCRIPTION_VERSIONS + 1,
      select: {
        id: true,
        version: true,
        contentText: true,
        authorId: true,
        author: { select: { displayName: true } },
        agentId: true,
        createdAt: true,
      },
    })
    const hasMore = versionRows.length > MAX_DESCRIPTION_VERSIONS
    const versions = versionRows.slice(0, MAX_DESCRIPTION_VERSIONS)

    const agentIds = [...new Set(versions.flatMap((version) =>
      version.agentId ? [version.agentId] : []
    ))]
    const agents = agentIds.length > 0
      ? await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, displayName: true },
        })
      : []
    const agentNames = new Map(agents.map((agent) => [agent.id, agent.displayName]))

    return NextResponse.json({
      current: { contentText: stripHtml(task.description_?.content ?? '') },
      hasMore,
      versions: versions.map(({ author, ...version }) => ({
        ...version,
        actor: {
          displayName: version.agentId
            ? agentNames.get(version.agentId) ?? 'Unknown agent'
            : author?.displayName ?? 'Unknown user',
          type: version.agentId ? 'agent' : 'user',
        },
      })),
    })
  } catch (error) {
    console.error('[Task Description Versions] Error:', error)
    return jsonError('Internal server error', 500)
  }
}
