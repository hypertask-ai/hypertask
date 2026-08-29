/**
 * Section rename - delegates to centralized sectionService.
 * Used by: /api/section/rename (Pages)
 * Returns project_view for UI compatibility.
 */
import { ISection } from '@/models/model'
import getProjectView from '../projects/views/viewsHelperAPIfunctions'
import * as sectionService from './sectionService'

const RenameSection = async (
  userId: number,
  sectionId: number,
  newSection: ISection
) => {
  const result = await sectionService.updateSection({
    sectionId,
    section_title: newSection.section_title,
    ranking: newSection.ranking,
    deleted: newSection.deleted,
    visibility: newSection.visibility,
    isDone: newSection.isDone,
    userId
  })

  if (result.status !== 200 && result.status !== 204) {
    return { status: result.status, json: result.json }
  }

  // Pages API expects project_view_updated for cache update
  if (result.status === 200 && 'projectId' in result.json) {
    const project_view_updated = await getProjectView(
      (result.json as { projectId: number }).projectId,
      userId
    )
    return { status: 200, json: project_view_updated }
  }

  return { status: result.status, json: result.json }
}

export default RenameSection
