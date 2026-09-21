import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth'
import prisma from '@/lib/prisma'
import { priorityScore } from '@/lib/mcp/tasks/priorityScore'
import { blockerStillOpen } from '@/lib/mcp/tasks/blockerStillOpen'
import { columnRole } from '@/lib/mcp/boards/columnRole'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { loadDoneTitlesByProject } from '@/utils/controllers/notifications/inboxZero'

const LABEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i


// Upper bound on claimable tasks pulled into memory before scoring/sorting.
const CANDIDATE_LIMIT = 500
const mcpDoneNameFallback = (title: string) => columnRole(title) === 'done'

function isLabelIdParam(raw: string): boolean {
  return /^\d+$/.test(raw) || LABEL_ID_UUID_RE.test(raw)
}

function parsePositiveInteger(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null

  const value = Number(raw.trim())
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function validationError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: 'Validation error',
      message,
    },
    { status: 400 }
  )
}

type ClaimableTaskWhereInput = Prisma.TaskWhereInput & {
  taskLease: {
    isNot: {
      expiresAt: { gt: Date }
    }
  }
}

/**
 * GET /api/mcp/tasks/next
 *
 * Returns the highest-priority unleased tasks in one accessible project.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request)
    if (rateLimited) return rateLimited

    const ctx = await validateMcpAuth(request)
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.',
        },
        { status: 401 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const projectIdRaw = searchParams.get('project_id')
    if (projectIdRaw === null) {
      return validationError('project_id is required')
    }

    const projectId = parsePositiveInteger(projectIdRaw)
    if (projectId === null) {
      return validationError('project_id must be a positive integer')
    }

    const limitRaw = searchParams.get('limit')
    const parsedLimit = limitRaw === null ? 10 : parsePositiveInteger(limitRaw)
    if (parsedLimit === null) {
      return validationError('limit must be a positive integer')
    }
    const limit = Math.min(parsedLimit, 50)

    const projectAccessWhere = getProjectWhere(ctx.user.id, ctx.agentId)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: 'Normal',
        ...projectAccessWhere,
      },
      select: {
        id: true,
      },
    })

    if (!project) {
      return NextResponse.json(
        {
          success: false,
          error: 'Project not found or access denied',
        },
        { status: 403 }
      )
    }

    const section = searchParams.get('section')?.trim() || undefined
    const excludeBlockedParam = searchParams.get('exclude_blocked')
    if (
      excludeBlockedParam !== null &&
      excludeBlockedParam !== 'true' &&
      excludeBlockedParam !== 'false'
    ) {
      return validationError("exclude_blocked must be either 'true' or 'false'")
    }
    const excludeBlocked = excludeBlockedParam === 'true'
    const labelFilters = (searchParams.get('labels') ?? '')
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
    const labelIds = labelFilters.filter(isLabelIdParam)
    const labelNames = labelFilters.filter((label) => !isLabelIdParam(label))
    const now = new Date()
    const doneTitlesByProject = await loadDoneTitlesByProject(
      [projectId],
      mcpDoneNameFallback
    )
    const projectDoneTitles = doneTitlesByProject.get(projectId)

    // isNot also matches tasks with no lease relation.
    const where: ClaimableTaskWhereInput = {
      projectId,
      project: projectAccessWhere,
      status: 'Normal',
      // An explicit section is intentional, even when the board marks it finished.
      ...(section
        ? { section }
        : projectDoneTitles && projectDoneTitles.size > 0
          ? {
              section: {
                notIn: Array.from(projectDoneTitles),
                mode: 'insensitive',
              },
            }
          : {}),
      ...(labelFilters.length > 0
        ? {
            taskLabels: {
              some: {
                OR: [
                  ...(labelIds.length > 0
                    ? [{ labelId: { in: labelIds } }]
                    : []),
                  ...(labelNames.length > 0
                    ? [{ label: { value: { in: labelNames } } }]
                    : []),
                ],
              },
            },
          }
        : {}),
      taskLease: {
        isNot: {
          expiresAt: { gt: now },
        },
      },
    }

    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        section: true,
        priority: {
          select: {
            Priority_Value: true,
          },
        },
        dueDate: true,
        createdAt: true,
        taskLabels: {
          select: {
            label: {
              select: {
                id: true,
                value: true,
              },
            },
          },
          orderBy: { labelId: 'asc' },
        },
        // Blocking relations for the exclude_blocked filter. A task is blocked
        // if it is the SOURCE of a BlockedBy row (T blocked by target) or the
        // TARGET of a BlockedTo row (source blocks T) — both directions, matching
        // getTaskCountSelect's convention. Selected unconditionally so the row
        // type stays stable; the filter below only consults it when asked.
        relatedFromTasks: {
          where: { relationType: 'BlockedBy' },
          select: {
            targetTask: { select: { status: true, section: true, projectId: true } },
          },
        },
        relatedToTasks: {
          where: { relationType: 'BlockedTo' },
          select: {
            sourceTask: { select: { status: true, section: true, projectId: true } },
          },
        },
      },
      // Bound the candidate set so a busy board can't turn this into an
      // unbounded fetch. Oldest-first matches the score tie-break; the score
      // itself is applied in code below.
      // ponytail: hard cap. If a board ever holds >CANDIDATE_LIMIT claimable
      // tasks, an urgent one past the cap could be missed — move scoring into
      // SQL (ORDER BY priority, dueDate) at that point.
      orderBy: { createdAt: 'asc' },
      take: CANDIDATE_LIMIT,
    })

    const blockerProjectIds = tasks.flatMap((task) => [
      ...task.relatedFromTasks.map((relation) => relation.targetTask.projectId),
      ...task.relatedToTasks.map((relation) => relation.sourceTask.projectId),
    ])
    if (excludeBlocked) {
      const blockerDoneTitlesByProject = await loadDoneTitlesByProject(
        blockerProjectIds.filter(
          (blockerProjectId) => !doneTitlesByProject.has(blockerProjectId)
        ),
        mcpDoneNameFallback
      )
      blockerDoneTitlesByProject.forEach((doneTitles, blockerProjectId) => {
        doneTitlesByProject.set(blockerProjectId, doneTitles)
      })
    }

    // Drop tasks with an open blocker (either direction) using each blocker's
    // own board's resolved finished columns.
    const candidates = excludeBlocked
      ? tasks.filter((task) => {
          const blockers = [
            ...task.relatedFromTasks.map((r) => r.targetTask),
            ...task.relatedToTasks.map((r) => r.sourceTask),
          ]
          return !blockers.some((blocker) =>
            blockerStillOpen(blocker, doneTitlesByProject.get(blocker.projectId))
          )
        })
      : tasks

    const rankedTasks = candidates
      .map((task) => ({
        task,
        score: priorityScore(
          task.priority?.Priority_Value,
          task.dueDate,
          now
        ),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.task.createdAt.getTime() - b.task.createdAt.getTime()
      )

    return NextResponse.json({
      success: true,
      tasks: rankedTasks.slice(0, limit).map(({ task, score }) => ({
        id: task.id,
        ticketNumber: task.ticketNumber || undefined,
        title: task.title,
        section: task.section,
        priority: task.priority?.Priority_Value || undefined,
        dueDate: task.dueDate?.toISOString() || undefined,
        score,
        labels: task.taskLabels.map(({ label }) => ({
          id: label.id,
          name: label.value || '',
        })),
      })),
      total: rankedTasks.length,
    })
  } catch (error) {
    console.error('[MCP] tasks/next', { error })
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}
