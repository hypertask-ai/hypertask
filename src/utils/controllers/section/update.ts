/**
 * Section update - delegates to centralized sectionService.
 * Used by: /api/section/update (Pages), MCP update/delete
 */
import { ISection } from '@/models/model'
import prisma from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/flags'
import { HTPR_7036_CTRLK_COLUMN_DELETE_KEEPS_CARDS_FLAG } from '@/lib/flags/keys'
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes'
import * as sectionService from './sectionService'

const sectionUpdate = async (
  _userId: number,
  sectionId: number,
  newSection: ISection
) => {
  const section = await prisma.section.findFirst({
    where: {
      id: sectionId,
      project: {
        status: 'Normal',
        ...getProjectWhere(_userId, undefined)
      }
    },
    select: { id: true, projectId: true }
  })
  if (!section) {
    return { status: 403, json: { message: 'Forbidden' } }
  }

  if (newSection.deleted === true && await isFeatureEnabled(HTPR_7036_CTRLK_COLUMN_DELETE_KEEPS_CARDS_FLAG, _userId)) {
    // Ctrl+K and the column header share this endpoint; move cards before hiding their column.
    const result = await sectionService.deleteSection({ sectionId, projectId: section.projectId, userId: _userId })
    return { status: result.status, json: { projectId: section.projectId, ...result.json } }
  }

  const result = await sectionService.updateSection({
    sectionId,
    section_title: newSection.section_title,
    ranking: newSection.ranking,
    deleted: newSection.deleted,
    visibility: newSection.visibility,
    isDone: newSection.isDone,
    userId: _userId
  })
  return {
    status: result.status,
    json: result.json
  }
}

export default sectionUpdate
