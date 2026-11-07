import { reportMcpOperationCrash } from '@/lib/mcp/operationCrashReport'
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG } from '@/lib/flags/definitions/htpr-8786-picker-skips-other-agents'
import { HTPR_8738_PICKER_SKIPS_PARKED_FLAG } from '@/lib/flags/definitions/htpr-8738-picker-skips-parked'
import { priorityScore } from '@/lib/mcp/tasks/priorityScore'
import { otherAgentAssigneeWhere } from '@/lib/mcp/tasks/otherAgentAssignee'
import { blockerStillOpen } from '@/lib/mcp/tasks/blockerStillOpen'
import { columnRole } from '@/lib/mcp/boards/columnRole'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import { loadDoneTitlesByProject } from '@/utils/controllers/notifications/inboxZero'
import { findIdParamOutOfRange, idOutOfRangeMessage, parseSectionFilter } from '@/lib/mcp/listParams'

const LABEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i


const CANDIDATE_LIMIT = 500
const mcpDoneNameFallback = (title: string) => columnRole(title) === 'done'

function parkedSection(title: string): boolean {
  const normalized = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  return [' ai review ', ' valentin review ', ' ux sign off ', ' flags '].includes(normalized)
}

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

    const projectAccessWhere = getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: 'Normal',
        ...getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope),
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

    const sectionFilter = parseSectionFilter(searchParams.get('section'))
    const section = sectionFilter.section
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
    const skipOtherAgents =
      ctx.agentId != null &&
      (await isFeatureEnabled(
        HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG,
        ctx.user.id,
      ))
    const skipParked =
      sectionFilter.sectionId === undefined &&
      !section &&
      (await isFeatureEnabled(
        HTPR_8738_PICKER_SKIPS_PARKED_FLAG,
        ctx.user.id,
      ))
    const doneTitlesByProject = await loadDoneTitlesByProject(
      [projectId],
      mcpDoneNameFallback
    )
    const projectDoneTitles = doneTitlesByProject.get(projectId)

    const sectionIdOutOfRange = findIdParamOutOfRange({ section: sectionFilter.sectionId })
    if (sectionIdOutOfRange) return validationError(idOutOfRangeMessage(sectionIdOutOfRange))

    const sectionWhere: Prisma.TaskWhereInput =
      sectionFilter.sectionId !== undefined
        ? { sectionId: sectionFilter.sectionId }
        : section
          ? { section }
          : projectDoneTitles && projectDoneTitles.size > 0
            ? {
                section: {
                  notIn: Array.from(projectDoneTitles),
                  mode: 'insensitive',
                },
              }
            : {}

    const where: ClaimableTaskWhereInput = {
      projectId,
      status: 'Normal',
      ...sectionWhere,
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
    const claimableWhere: Prisma.TaskWhereInput = {
      ...where,
      ...(ctx.agentId != null && skipOtherAgents
        ? otherAgentAssigneeWhere(ctx.agentId)
        : {}),
      ...(skipParked
        ? {
            waitingOnUserId: null,
            blockerCommentId: null,
            NOT: {
              OR: [
                { section: { equals: 'AI Review', mode: 'insensitive' } },
                { section: { equals: 'Valentin Review', mode: 'insensitive' } },
                { section: { equals: 'UX Sign-off', mode: 'insensitive' } },
                { section: { equals: 'UX Sign off', mode: 'insensitive' } },
                { section: { equals: 'Flags', mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    }

    const tasks = await prisma.task.findMany({
      where: { ...claimableWhere, project: getProjectWhere(ctx.user.id, ctx.agentId, ctx.teamScope) },
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        section: true,
        waitingOnUserId: true,
        blockerCommentId: true,
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
          where: { relationType: 'BlockedBy', ...(ctx.teamScope == null ? {} : { targetTask: { project: projectAccessWhere } }) },
          select: {
            targetTask: { select: { status: true, section: true, projectId: true } },
          },
        },
        relatedToTasks: {
          where: { relationType: 'BlockedTo', ...(ctx.teamScope == null ? {} : { sourceTask: { project: projectAccessWhere } }) },
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

    const activeTasks = skipParked
      ? candidates.filter(
          (task) =>
            task.waitingOnUserId == null &&
            task.blockerCommentId == null &&
            !parkedSection(task.section)
        )
      : candidates

    const rankedTasks = activeTasks
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
