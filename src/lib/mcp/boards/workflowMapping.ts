import prisma from '@/lib/prisma'
import { columnRoleFor, type BoardColumnRole } from './columnRole'

type SectionWorkflowRow = {
  section_title: string
  isDone?: boolean | null
}

export function columnWorkflowRole(section: SectionWorkflowRow): BoardColumnRole {
  return columnRoleFor(section)
}

export function formatBoardWorkflowMapping(sections: SectionWorkflowRow[]): string {
  return sections
    .map((section) => `${section.section_title} (${columnWorkflowRole(section)})`)
    .join(', ')
}

export async function loadBoardWorkflowMapping(projectId: number): Promise<string> {
  const sections = await prisma.section.findMany({
    where: { projectId, deleted: false, visibility: true },
    select: { section_title: true, isDone: true },
    orderBy: { ranking: 'asc' },
  })
  return formatBoardWorkflowMapping(sections)
}
