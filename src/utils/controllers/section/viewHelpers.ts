import { Prisma } from '@prisma/client'
import { ISection } from '@/models/model'
import prisma from '@/lib/prisma'
import sortByStringParam from '@/utils/sortByParam'
import { buildViewColumnEntry } from './viewColumnEntry'
import { applyColumnVisibility } from './viewColumnVisibility'

async function updateBoardViewColumns(
  projectId: number,
  mapColumns: (columns: ISection[]) => unknown[],
  where: Prisma.ViewWhereInput = {}
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT v."id"
      FROM "View" v
      JOIN "Project_View" pv ON pv."id" = v."project_view_id"
      WHERE pv."projectId" = ${projectId}
      FOR UPDATE OF v
    `
    const views = await tx.view.findMany({
      where: { ...where, project_view: { projectId } },
      select: { id: true, board_columns_view: true }
    })
    for (const view of views) {
      const columns = mapColumns(
        (view.board_columns_view as unknown as ISection[]) ?? []
      )
      await tx.view.update({
        where: { id: view.id },
        data: { board_columns_view: columns as unknown as Prisma.InputJsonValue }
      })
    }
  }, { timeout: 20000, maxWait: 10000 })
}

export async function appendSectionToAllViews(
  projectId: number,
  section: { id: number; section_title: string; ranking: string; [key: string]: unknown },
  _currentUserId?: number
) {
  await updateBoardViewColumns(projectId, (columns) => [
    ...columns,
    buildViewColumnEntry(section)
  ])
}

export async function updateSectionInAllViews(
  projectId: number,
  sectionId: number,
  updates: { section_title?: string; ranking?: string; isDone?: boolean | null }
) {
  await updateBoardViewColumns(projectId, (columns) => {
    const updated = columns.map((col) =>
      col.id === sectionId ? { ...col, ...updates } : col
    )
    return updates.ranking !== undefined && updates.ranking !== null
      ? sortByStringParam([...updated], 'ranking')
      : updated
  })
}

export async function removeSectionFromAllViews(sectionId: number, projectId: number) {
  await updateBoardViewColumns(projectId, (columns) =>
    columns.filter((col) => col.id !== sectionId)
  )
}

export async function setSectionVisibilityInAllViews(
  section: { id: number; projectId: number; section_title: string; ranking: string },
  visible: boolean,
  actingUserId: number
) {
  await updateBoardViewColumns(
    section.projectId,
    (columns) => applyColumnVisibility(columns, section, visible),
    {
      OR: [
        { unsaved_User_Project_View: { none: {} } },
        { unsaved_User_Project_View: { some: { userId: actingUserId } } }
      ]
    }
  )
}
