/**
 * Centralized Section CRUD service.
 * Both Pages API and MCP endpoints should use this service.
 * All view updates (default, applied, unsaved) are handled here.
 */
import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import generateRank from '@/utils/generateRank'
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
  /** When provided, visibility is ON only in views owned by this user */
  userId?: number
}

export type CreateSectionResult =
  | { status: 200; json: { id: number; section_title: string; projectId: number; visibility: boolean; deleted: boolean; ranking: string; isDone: boolean | null } }
  | { status: 400 | 404 | 500; json: { message: string } | unknown }

/**
 * Create a new section. Updates all project views.
 */
export async function createSection(input: CreateSectionInput): Promise<CreateSectionResult> {
  const { projectId, title, ranking: explicitRanking, afterSectionId, userId } = input

  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) {
    return { status: 400, json: { message: 'Project not found' } }
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
    const section = await prisma.section.create({
      data: {
        project: { connect: { id: projectId } },
        section_title: title,
        visibility: true,
        deleted: false,
        ranking: ranking as string
      }
    })

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
  autoAssignUserId?: number | null
  autoAssignAgentId?: string | null
  /** Place section after this section ID; ranking is computed. Use with projectId. */
  moveAfterSectionId?: number
  projectId?: number
  userId: number
  agentId?: string | null
}

export type UpdateSectionResult =
  | { status: 200 | 204; json: { id: number; section_title: string; projectId: number; visibility: boolean; deleted: boolean; ranking: string; isDone: boolean | null; autoAssignUserId: number | null; autoAssignAgentId: string | null } }
  | { status: 400 | 403 | 404 | 500; json: { message: string } | unknown }

async function canAccessProject(
  projectId: number,
  userId: number,
  agentId?: string | null
): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: 'Normal',
      ...getProjectWhere(userId, agentId)
    },
    select: { id: true }
  })

  return Boolean(project)
}

/**
 * Update a section (rename, move, delete, visibility).
 * Updates Section record, tasks when title changes, and all views.
 */
export async function updateSection(input: UpdateSectionInput): Promise<UpdateSectionResult> {
  const { sectionId, section_title, ranking, deleted, visibility, isDone, autoAssignUserId, autoAssignAgentId, moveAfterSectionId, projectId, userId, agentId } = input

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

    const hasAccess = await canAccessProject(existing.projectId, userId, agentId)
    if (!hasAccess) {
      return { status: 403, json: { message: 'User does not have permission to update this section' } }
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
    const toUpdate = await prisma.$transaction(async (tx) => {
      const updated = await tx.section.update({
        where: { id: sectionId },
        data: {
          ...(section_title != null && { section_title }),
          ...(finalRanking != null && { ranking: finalRanking }),
          ...(deleted != null && { deleted }),
          ...(visibility != null && { visibility }),
          ...(isDone !== undefined && { isDone }),
          ...(autoAssignUserId !== undefined && { autoAssignUserId }),
          ...(autoAssignAgentId !== undefined && { autoAssignAgentId })
        }
      })

      // Keep the task name update and its history row in one transaction.
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

      return updated
    })

    // View updates based on operation
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
}

export interface DeleteSectionResult {
  status: number
  movedTaskCount?: number
  destinationSection?: { id: number; title: string } | null
}

/**
 * Delete a section (soft delete). Moves tasks to first section, updates all views.
 */
export async function deleteSection(input: DeleteSectionInput): Promise<DeleteSectionResult> {
  const { sectionId, projectId, userId, agentId } = input

  const section = await prisma.section.findFirst({
    where: { id: sectionId, projectId }
  })
  if (!section) {
    return { status: 404 }
  }

  const hasAccess = await canAccessProject(section.projectId, userId, agentId)
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
    if (taskCount > 0) return { status: 400 }
  }

  let movedTaskCount = 0
  if (firstSection) {
    const moved = await prisma.$transaction(async (tx) => {
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
        select: { id: true }
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
      return { count: tasks.length }
    })
    movedTaskCount = moved.count
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
