import { HTPR_7975_COLUMN_WORK_LIMITS_FLAG } from "@/lib/flags/definitions/htpr-7975-column-work-limits";
import { isFeatureEnabled } from '@/lib/flags'
import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types'
import type { Task } from '@prisma/client'
import prisma from '@/lib/prisma'
import { wipLimitSchema } from '@/lib/api/contracts/sectionWrites'
import { scheduleAgentFirstTaskEmailBatch } from '@/utils/controllers/notifications/agentFirstTaskEmail'
import { enqueueAgentTaskCompletion } from '@/lib/telemetry/activationOccurrences'
import { getProjectWhere, savedViewBoardAccessWhere } from '@/utils/controllers/projects/getAllIncludes'
import generateRank from '@/utils/generateRank'
import { enqueueColumnCreated, enqueueColumnRenamed, processAnalyticsIntentSoon } from '@/lib/telemetry/savedWork'
import {
  appendSectionToAllViews,
  updateSectionInAllViews,
  removeSectionFromAllViews
} from './viewHelpers'

export interface CreateSectionInput {
  projectId: number
  title: string
  ranking?: string
  afterSectionId?: number
  userId: number
  agentId?: string | null
  teamScope?: AgentTokenTeamScope | null
}

export type CreateSectionResult =
  | { status: 200; json: { id: number; section_title: string; projectId: number; visibility: boolean; deleted: boolean; ranking: string; isDone: boolean | null } }
  | { status: 400 | 403 | 404 | 500; json: { message: string } | unknown }

export async function createSection(input: CreateSectionInput): Promise<CreateSectionResult> {
  const { projectId, title, ranking: explicitRanking, afterSectionId, userId, agentId, teamScope } = input

  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
    return { status: 403, json: { message: 'User does not have permission to add a section to this project' } }
  }
  const project = await prisma.project.findFirst({ where: { id: projectId, status: 'Normal', ...savedViewBoardAccessWhere(userId, agentId, teamScope) }, select: { id: true } })
  if (!project) {
    return { status: 403, json: { message: 'User does not have permission to add a section to this project' } }
  }

  let ranking = explicitRanking
  if (!ranking) {
    if (afterSectionId != null) {
      const sections = await prisma.section.findMany({
        where: { projectId, deleted: false },
        select: { id: true, ranking: true },
        orderBy: { ranking: 'asc' }
      })
      const afterIndex = sections.findIndex((s) => s.id === afterSectionId)
      if (afterIndex === -1) {
        return { status: 404, json: { message: `Section with ID ${afterSectionId} not found in project ${projectId}` } }
      }
      const prev = sections[afterIndex]
      const next = sections[afterIndex + 1]
      ranking = generateRank(prev.ranking, next?.ranking)
    } else {
      const last = await prisma.section.findFirst({
        where: { projectId, deleted: false },
        select: { ranking: true },
        orderBy: { ranking: 'desc' }
      })
      ranking = generateRank(last?.ranking, undefined)
    }
  }

  try {
    const { section, analyticsKey } = await prisma.$transaction(async (tx) => {
      const section = await tx.section.create({
        data: {
          project: { connect: { id: projectId } },
          section_title: title,
          visibility: true,
          deleted: false,
          ranking: ranking as string
        }
      })

      const analyticsKey = await enqueueColumnCreated(tx, section.id, { userId, agentId })
      return { section, analyticsKey }
    })
    processAnalyticsIntentSoon(analyticsKey)
    await appendSectionToAllViews(projectId, section, userId)

    return {
      status: 200,
      json: {
        id: section.id,
        section_title: section.section_title,
        projectId: section.projectId,
        visibility: section.visibility,
        deleted: section.deleted,
        ranking: section.ranking,
        isDone: section.isDone
      }
    }
  } catch (error) {
    console.error('Error creating section:', error)
    return { status: 500, json: error }
  }
}

export interface UpdateSectionInput {
  sectionId: number
  section_title?: string
  ranking?: string
  deleted?: boolean
  visibility?: boolean
  isDone?: boolean | null
  wipLimit?: number | null
  autoAssignUserId?: number | null
  autoAssignAgentId?: string | null
  moveAfterSectionId?: number
  projectId?: number
  userId: number
  agentId?: string | null
  teamScope?: AgentTokenTeamScope | null
}

export type UpdateSectionResult =
  | { status: 200 | 204; json: { id: number; section_title: string; projectId: number; visibility: boolean; deleted: boolean; ranking: string; isDone: boolean | null; wipLimit: number | null; autoAssignUserId: number | null; autoAssignAgentId: string | null } }
  | { status: 400 | 403 | 404 | 500; json: { message: string } | unknown }

async function canAccessProject(
  projectId: number,
  userId: number,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: 'Normal',
      ...getProjectWhere(userId, agentId, teamScope)
    },
    select: { id: true }
  })

  return Boolean(project)
}

export async function updateSection(input: UpdateSectionInput): Promise<UpdateSectionResult> {
  const { sectionId, section_title, ranking, deleted, visibility, isDone, wipLimit, autoAssignUserId, autoAssignAgentId, moveAfterSectionId, projectId, userId, agentId, teamScope } = input

  if (!wipLimitSchema.optional().safeParse(wipLimit).success) {
    return { status: 400, json: { message: "Work limit must be a positive whole number or null" } }
  }

  try {
    const existing = await prisma.section.findUnique({
      where: { id: sectionId }
    })
    if (!existing) {
      return { status: 400, json: { message: 'Section not found' } }
    }

    if (projectId != null && projectId !== existing.projectId) {
      return { status: 404, json: { message: `Section with ID ${sectionId} not found in project ${projectId}` } }
    }

    const titleChanged =
      section_title != null && section_title !== existing.section_title

    const hasAccess = await canAccessProject(existing.projectId, userId, agentId, teamScope)
    if (!hasAccess) {
      return { status: 403, json: { message: 'User does not have permission to update this section' } }
    }

    if (wipLimit !== undefined && !(await isFeatureEnabled(HTPR_7975_COLUMN_WORK_LIMITS_FLAG, userId))) {
      return { status: 403, json: { message: 'Column work limits are not enabled' } }
    }

    let resolvedRanking = ranking
    if (resolvedRanking == null && moveAfterSectionId != null) {
      const sections = await prisma.section.findMany({
        where: { projectId: existing.projectId, deleted: false },
        select: { id: true, ranking: true },
        orderBy: { ranking: 'asc' }
      })
      const idx = sections.findIndex((s) => s.id === moveAfterSectionId)
      if (idx === -1) {
        return { status: 404, json: { message: `Section with ID ${moveAfterSectionId} not found in project` } }
      }
      const prev = sections[idx]
      const next = sections[idx + 1]
      resolvedRanking = generateRank(prev.ranking, next?.ranking) as string
    }

    const finalRanking = resolvedRanking ?? ranking
    const { toUpdate, analyticsKey } = await prisma.$transaction(async (tx) => {
      const updated = await tx.section.update({
        where: { id: sectionId },
        data: {
          ...(section_title != null && { section_title }),
          ...(finalRanking != null && { ranking: finalRanking }),
          ...(deleted != null && { deleted }),
          ...(visibility != null && { visibility }),
          ...(isDone !== undefined && { isDone }),
          ...(wipLimit !== undefined && { wipLimit }),
          ...(autoAssignUserId !== undefined && { autoAssignUserId }),
          ...(autoAssignAgentId !== undefined && { autoAssignAgentId })
        }
      })

      if (titleChanged) {
        const tasks = await tx.task.updateManyAndReturn({
          where: { sectionId },
          data: { section: section_title },
          select: { id: true }
        })
        if (tasks.length > 0) {
          const timestamp = new Date()
          await tx.taskSectionEvent.createMany({
            data: tasks.map(({ id }) => ({
              taskId: id,
              from: existing.section_title,
              to: section_title,
              userId,
              timestamp
            }))
          })
        }
      }

      const analyticsKey = titleChanged && !updated.deleted
        ? await enqueueColumnRenamed(tx, sectionId, { userId, agentId })
        : null
      return { toUpdate: updated, analyticsKey }
    })

    if (analyticsKey) processAnalyticsIntentSoon(analyticsKey)

    if (toUpdate.deleted) {
      await removeSectionFromAllViews(sectionId, toUpdate.projectId)
    } else if (titleChanged || finalRanking != null || isDone !== undefined) {
      const updates: { section_title?: string; ranking?: string; isDone?: boolean | null } = {}
      if (titleChanged) updates.section_title = section_title
      if (finalRanking) updates.ranking = finalRanking
      if (isDone !== undefined) updates.isDone = isDone
      await updateSectionInAllViews(toUpdate.projectId, sectionId, updates)
    }

    return {
      status: toUpdate.deleted ? 204 : 200,
      json: {
        id: toUpdate.id,
        section_title: toUpdate.section_title,
        projectId: toUpdate.projectId,
        visibility: toUpdate.visibility,
        deleted: toUpdate.deleted,
        ranking: toUpdate.ranking,
        isDone: toUpdate.isDone,
        wipLimit: toUpdate.wipLimit,
        autoAssignUserId: toUpdate.autoAssignUserId,
        autoAssignAgentId: toUpdate.autoAssignAgentId
      }
    }
  } catch (error) {
    console.error('Error updating section:', error)
    return { status: 500, json: { message: 'Section not found' } }
  }
}

export interface DeleteSectionInput {
  sectionId: number
  projectId: number
  userId: number
  agentId?: string | null
  teamScope?: AgentTokenTeamScope | null
}

export interface DeleteSectionResult {
  status: number
  json?: { message: string; code: string }
  movedTaskCount?: number
  destinationSection?: { id: number; title: string } | null
}

export async function deleteSection(input: DeleteSectionInput): Promise<DeleteSectionResult> {
  const { sectionId, projectId, userId, agentId, teamScope } = input

  const section = await prisma.section.findFirst({
    where: { id: sectionId, projectId }
  })
  if (!section) {
    return { status: 404 }
  }

  const hasAccess = await canAccessProject(section.projectId, userId, agentId, teamScope)
  if (!hasAccess) {
    return { status: 403 }
  }

  const firstSection = await prisma.section.findFirst({
    where: { projectId, deleted: false, id: { not: sectionId } },
    orderBy: { ranking: 'asc' }
  })

  if (!firstSection) {
    const taskCount = await prisma.task.count({
      where: {
        projectId,
        OR: [{ sectionId }, { section: section.section_title }],
        status: 'Normal'
      }
    })
    if (taskCount > 0) {
      return {
        status: 400,
        json: {
          message: "This is the board's last column. Move or delete its cards first.",
          code: 'LAST_COLUMN_HAS_CARDS'
        }
      }
    }
  }

  let movedTaskCount = 0
  if (firstSection) {
    const moved = await prisma.$transaction(async (tx) => {
      const beforeTasks = agentId ? await tx.$queryRaw<Pick<Task, 'id' | 'projectId' | 'uniqueIndex' | 'title' | 'sectionId' | 'section' | 'status'>[]>`
        SELECT id, "projectId", "uniqueIndex", title, "sectionId", section, status FROM "Task"
        WHERE "projectId" = ${projectId}
          AND ("sectionId" = ${sectionId} OR section = ${section.section_title})
          AND status = 'Normal'
        ORDER BY id
        FOR UPDATE
      ` : []
      const timestamp = new Date()
      const tasks = await tx.task.updateManyAndReturn({
        where: {
          projectId,
          OR: [{ sectionId }, { section: section.section_title }],
          status: 'Normal'
        },
        data: {
          section: firstSection.section_title,
          sectionId: firstSection.id,
          sectionChangedAt: timestamp
        },
        select: { id: true, projectId: true, uniqueIndex: true, title: true, sectionId: true, section: true, status: true }
      })
      if (tasks.length > 0) {
        await tx.taskSectionEvent.createMany({
          data: tasks.map(({ id }) => ({
            taskId: id,
            from: section.section_title,
            to: firstSection.section_title,
            userId,
            timestamp
          }))
        })
      }
      const analyticsKeys: string[] = []
      for (const before of beforeTasks) {
        const after = tasks.find((task) => task.id === before.id)
        if (!after) continue
        const key = await enqueueAgentTaskCompletion(tx, before, { ...after, updatedAt: timestamp }, agentId)
        if (key) analyticsKeys.push(key)
      }
      return { tasks, beforeTasks, timestamp, analyticsKeys }
    })
    moved.analyticsKeys.forEach(processAnalyticsIntentSoon)
    movedTaskCount = moved.tasks.length
    if (agentId && moved.beforeTasks.length) {
      const afterTasks = new Map(moved.tasks.map((task) => [task.id, task]))
      scheduleAgentFirstTaskEmailBatch(moved.beforeTasks.flatMap((before) => {
        const after = afterTasks.get(before.id)
        if (!after) return []
        return [{ before, after }]
      }), userId, agentId)
    }
  }

  await updateSection({
    sectionId,
    deleted: true,
    userId,
    agentId
  })

  return {
    status: 204,
    movedTaskCount,
    destinationSection: firstSection
      ? { id: firstSection.id, title: firstSection.section_title }
      : null
  }
}
