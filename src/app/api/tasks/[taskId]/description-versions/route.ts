import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isValidUser } from '@/utils/edgeHelpers'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'

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

function parseTaskId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null

  const taskId = Number(value)
  return Number.isSafeInteger(taskId) && taskId > 0 ? taskId : null
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
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
        description_: { select: { content: true } },
      },
    })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
