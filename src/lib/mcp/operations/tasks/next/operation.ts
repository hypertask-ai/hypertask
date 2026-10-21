import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { priorityScore } from '@/lib/mcp/tasks/priorityScore'
import { blockerStillOpen } from '@/lib/mcp/tasks/blockerStillOpen'
import { columnRole } from '@/lib/mcp/boards/columnRole'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { loadDoneTitlesByProject } from '@/utils/controllers/notifications/inboxZero'

const LABEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i


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

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
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

    const where: ClaimableTaskWhereInput = {
      projectId,
      project: projectAccessWhere,
      status: 'Normal',
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
    reportMcpOperationCrash(request, error)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }

  })(request)
}
