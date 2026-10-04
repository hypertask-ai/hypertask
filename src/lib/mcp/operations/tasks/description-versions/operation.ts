import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import { validateProjectAccess } from '@/lib/mcp/tasks/services'
import { resolveTaskIdOnly } from '@/lib/mcp/tasks/resolveTask'
import { htmlToMarkdown } from '@/utils/controllers/pages/htmlToMarkdown'

// GET /api/mcp/tasks/description-versions?task_id=123
// History of a task's description. Newest version first. Content as markdown.
export async function GET(request: NextRequest) {
  try {
    const ctx = await validateMcpAuth(request)
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    // Accept the same identifiers as every other task route. Requiring the
    // internal numeric id forced callers working from a ticket number to make
    // an extra lookup first, which nothing else here does.
    const params = request.nextUrl.searchParams
    const raw = params.get('task_id')
    const rawIndex = params.get('unique_index')
    const rawProject = params.get('project_id')
    const taskId = await resolveTaskIdOnly({
      task_id: raw && /^\d+$/.test(raw) ? Number(raw) : null,
      ticket_number: params.get('ticket_number'),
      unique_index: rawIndex && /^\d+$/.test(rawIndex) ? Number(rawIndex) : null,
      project_id: rawProject && /^\d+$/.test(rawProject) ? Number(rawProject) : null,
    })
    if (taskId === null || taskId <= 0) {
      return NextResponse.json(
        buildFieldError(
          raw || params.get('ticket_number') || rawIndex ? 'invalid_field' : 'missing_field',
          'task_id',
          'Provide task_id, ticket_number, or project_id + unique_index'
        ),
        { status: 400 }
      )
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    })
    if (!task || (await validateProjectAccess(task.projectId, ctx.user.id, ctx.agentId)).error) {
      return NextResponse.json(
        buildFieldError('not_found', 'task_id', 'Task not found'),
        { status: 404 }
      )
    }

    const versions = await prisma.docVersion.findMany({
      where: { entityType: 'task_description', entityId: taskId },
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        version: true,
        contentHtml: true,
        authorId: true,
        agentId: true,
        note: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        content: htmlToMarkdown(v.contentHtml),
        author_id: v.authorId,
        agent_id: v.agentId,
        note: v.note,
        created_at: v.createdAt,
      })),
    })
  } catch (error) {
    console.error('[MCP Task Description Versions] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
