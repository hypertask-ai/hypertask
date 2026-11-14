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

export async function sectionRefusal(projectId: number, sectionId: number, listColumns: boolean): Promise<string> {
  const plain = `Section with ID ${sectionId} not found in project ${projectId}`
  return listColumns ? `${plain}.${boardColumnsLine(await visibleBoardColumns(projectId))}` : plain
}
