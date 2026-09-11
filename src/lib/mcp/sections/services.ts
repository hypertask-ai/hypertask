import prisma from '@/lib/prisma'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import * as sectionService from '@/utils/controllers/section/sectionService'
import { validateProjectMemberIds } from '@/lib/mcp/tasks/services'
import { isAgentOnBoard } from '@/utils/controllers/agents/boardMembers'

export type SectionAutoAssign = number | string | null

async function verifyProjectAccess(
  projectId: number,
  userId: number,
  agentId?: string | null
): Promise<{ ok: true } | { ok: false; error: CreateSectionError }> {
  const projectExists = await prisma.project.findFirst({
    where: { id: projectId, status: 'Normal' },
    select: { id: true }
  })

  if (!projectExists) {
    return { ok: false, error: { success: false, error: 'Not found', message: `Project with ID ${projectId} not found`, status: 404 } }
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: 'Normal',
      ...getProjectWhere(userId, agentId),
    },
    select: { id: true }
  })

  if (!project) {
    return { ok: false, error: { success: false, error: 'Permission error', message: 'User does not have permission in this project', status: 403 } }
  }

  return { ok: true }
}

export interface CreateSectionParams {
  projectId: number
  title: string
  userId: number
  afterSectionId?: number
}

export interface CreateSectionResult {
  success: true
  section: {
    id: number
    section_title: string
    projectId: number
    visibility: boolean
    deleted: boolean
    ranking: string
    isDone?: boolean | null
  }
}

export interface CreateSectionError {
  success: false
  error: string
  message?: string
  details?: { field: string; code: string }
  status: number
}

/**
 * Creates a new section (column) in a project.
 * Delegates to the existing sectionCreate controller; ranking is computed there.
 * Returns errors per API spec: 404 for missing project, 403 for no access.
 */
export async function createSection(
  params: CreateSectionParams,
  agentId?: string | null
): Promise<CreateSectionResult | CreateSectionError> {
  const { projectId, title, userId, afterSectionId } = params

  const access = await verifyProjectAccess(projectId, userId, agentId)
  if (!access.ok) return access.error

  const result = await sectionService.createSection({
    projectId,
    title,
    afterSectionId,
    userId
  })

  if (result.status !== 200) {
    const errorMessage =
      typeof result.json === 'object' && result.json && 'message' in result.json
        ? String((result.json as { message: string }).message)
        : 'An unexpected error occurred while creating the section'
    const isNotFound = result.status === 404
    return {
      success: false,
      error: isNotFound ? 'Not found' : 'Validation error',
      message: errorMessage,
      status: result.status
    }
  }

  const section = result.json as CreateSectionResult['section']
  return {
    success: true,
    section: {
      id: section.id,
      section_title: section.section_title,
      projectId: section.projectId,
      visibility: section.visibility,
      deleted: section.deleted,
      ranking: section.ranking
    }
  }
}

// ---------------------------------------------------------------------------
// Update Section (rename and/or move)
// ---------------------------------------------------------------------------

export interface UpdateSectionParams {
  projectId: number
  sectionId: number
  userId: number
  title?: string
  moveAfterSectionId?: number
  /** Tickets in this column are finished. null clears it, falling back to the name guess. */
  isDone?: boolean | null
  /** Numeric user ID, agent UUID, or null to clear. */
  autoAssign?: SectionAutoAssign
}

export interface UpdateSectionResult {
  success: true
  section: CreateSectionResult['section'] & { autoAssign: SectionAutoAssign }
}

export async function updateSection(
  params: UpdateSectionParams,
  agentId?: string | null
): Promise<UpdateSectionResult | CreateSectionError> {
  const { projectId, sectionId, userId, title, moveAfterSectionId, isDone, autoAssign } = params

  const access = await verifyProjectAccess(projectId, userId, agentId)
  if (!access.ok) return access.error

  const section = await prisma.section.findFirst({
    where: { id: sectionId, projectId, deleted: false }
  })

  if (!section) {
    return {
      success: false,
      error: 'Not found',
      message: `Section with ID ${sectionId} not found in project ${projectId}`,
      status: 404
    }
  }

  if (
    autoAssign !== undefined &&
    autoAssign !== null &&
    !(
      (typeof autoAssign === 'number' && Number.isInteger(autoAssign) && autoAssign > 0) ||
      (typeof autoAssign === 'string' && autoAssign.trim().length > 0)
    )
  ) {
    return {
      success: false,
      error: 'Validation error',
      message: 'auto_assign must be a positive user ID, agent ID, or null',
      status: 400
    }
  }

  if (typeof autoAssign === 'number') {
    const memberCheck = await validateProjectMemberIds(projectId, [autoAssign])
    if (memberCheck.error) {
      return {
        success: false,
        error: 'Validation error',
        message: memberCheck.error.message,
        status: memberCheck.error.status
      }
    }
    if (memberCheck.invalidIds.length > 0) {
      return {
        success: false,
        error: 'Validation error',
        message: 'Auto-assign user must be a member of this board',
        status: 400
      }
    }
  }

  if (
    typeof autoAssign === 'string' &&
    !(await isAgentOnBoard(projectId, autoAssign))
  ) {
    return {
      success: false,
      error: 'Validation error',
      message: 'Auto-assign agent must be active on this board',
      status: 400
    }
  }

  const autoAssignProvided = autoAssign !== undefined

  const result = await sectionService.updateSection({
    sectionId,
    section_title: title?.trim() || undefined,
    moveAfterSectionId,
    isDone,
    autoAssignUserId:
      autoAssignProvided ? (typeof autoAssign === 'number' ? autoAssign : null) : undefined,
    autoAssignAgentId:
      autoAssignProvided ? (typeof autoAssign === 'string' ? autoAssign : null) : undefined,
    projectId,
    userId,
    agentId
  })

  if (result.status !== 200 && result.status !== 204) {
    const errorMessage =
      typeof result.json === 'object' && result.json && 'message' in result.json
        ? String((result.json as { message: string }).message)
        : 'Failed to update section'
    return {
      success: false,
      error: result.status === 404 ? 'Not found' : 'Validation error',
      message: errorMessage,
      status: result.status
    }
  }

  const updatedSection = result.json as CreateSectionResult['section'] & {
    autoAssignUserId: number | null
    autoAssignAgentId: string | null
  }
  return {
    success: true,
    section: {
      id: updatedSection.id,
      section_title: updatedSection.section_title,
      projectId: updatedSection.projectId,
      visibility: updatedSection.visibility,
      deleted: updatedSection.deleted,
      ranking: updatedSection.ranking,
      isDone: updatedSection.isDone,
      autoAssign:
        updatedSection.autoAssignAgentId ?? updatedSection.autoAssignUserId ?? null
    }
  }
}

// ---------------------------------------------------------------------------
// Delete Section
// ---------------------------------------------------------------------------

export interface DeleteSectionParams {
  projectId: number
  sectionId: number
  userId: number
}

export async function deleteSection(
  params: DeleteSectionParams,
  agentId?: string | null
): Promise<{
  success: true
  message: string
  movedTaskCount: number
  destinationSection: { id: number; title: string } | null
} | CreateSectionError> {
  const { projectId, sectionId, userId } = params

  const access = await verifyProjectAccess(projectId, userId, agentId)
  if (!access.ok) return access.error

  const result = await sectionService.deleteSection({ sectionId, projectId, userId, agentId })

  if (result.status === 404) {
    return {
      success: false,
      error: 'Not found',
      message: `Section with ID ${sectionId} not found in project ${projectId}`,
      status: 404
    }
  }

  if (result.status === 403) {
    return {
      success: false,
      error: 'Permission error',
      message: 'User does not have permission in this project',
      status: 403
    }
  }

  if (result.status !== 204) {
    return {
      success: false,
      error: 'Validation error',
      message: 'Cannot delete the only section while it still contains tasks',
      status: result.status
    }
  }

  return {
    success: true,
    message: 'Section deleted successfully',
    movedTaskCount: result.movedTaskCount ?? 0,
    destinationSection: result.destinationSection ?? null
  }
}
