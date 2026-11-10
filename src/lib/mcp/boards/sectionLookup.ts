import prisma from '@/lib/prisma'

export type BoardColumn = { id: number; section_title: string }

export async function visibleBoardColumns(projectId: number): Promise<BoardColumn[]> {
  return prisma.section.findMany({
    where: { projectId, deleted: false, visibility: true },
    select: { id: true, section_title: true },
    orderBy: { ranking: 'asc' },
  })
}

export function boardColumnsLine(columns: BoardColumn[]): string {
  if (columns.length === 0) return ''
  return ` Columns on this board: ${columns.map((column) => `${column.section_title} (id ${column.id})`).join(', ')}`
}

export async function missingSectionMessage(projectId: number, sectionId: number): Promise<string> {
  return `Section with ID ${sectionId} not found in project ${projectId}.${boardColumnsLine(await visibleBoardColumns(projectId))}`
}
