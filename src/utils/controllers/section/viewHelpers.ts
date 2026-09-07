/**
 * Shared view update helpers for section CRUD.
 * All section mutations that affect board_columns_view must go through these
 * so that default, applied, and unsaved views stay in sync.
 */
import { Prisma } from '@prisma/client'
import { ISection } from '@/models/model'
import prisma from '@/lib/prisma'
import sortByStringParam from '@/utils/sortByParam'
import { buildViewColumnEntry } from './viewColumnEntry'

/**
 * Append a new section to all views for a project.
 *
 * HTPR-5527: this used to set `visibility` to "is this view owned by the user
 * who created the column". The board only renders columns whose view entry has
 * `visibility: true`, so adding a column to a board whose active view belongs
 * to anyone else (the board's default view, a shared public view) created the
 * section in the database and then hid it — no column, no error, nothing to
 * click. A brand new column is always visible; hiding one is a deliberate
 * per-view choice made afterwards in Manage Columns.
 */
export async function appendSectionToAllViews(
  projectId: number,
  section: { id: number; section_title: string; ranking: string; [key: string]: unknown },
  _currentUserId?: number
) {
  const views = await prisma.view.findMany({
    where: { project_view: { projectId } },
    select: { id: true, userId: true, board_columns_view: true }
  })
  for (const view of views) {
    const sectionForView = buildViewColumnEntry(section)
    const currentColumns = (view.board_columns_view as unknown as Record<string, unknown>[]) ?? []
    const updated = [...currentColumns, sectionForView]
    await prisma.view.update({
      where: { id: view.id },
      data: { board_columns_view: updated as unknown as Prisma.InputJsonValue }
    })
  }
}

/**
 * Update a section in all views (rename and/or ranking).
 * Used when renaming or moving a section.
 * When ranking is updated, the array is re-sorted to reflect the new order.
 */
export async function updateSectionInAllViews(
  projectId: number,
  sectionId: number,
  updates: { section_title?: string; ranking?: string; isDone?: boolean | null }
) {
  const views = await prisma.view.findMany({
    where: { project_view: { projectId } }
  })
  for (const view of views) {
    const columns = (view.board_columns_view as unknown as ISection[]) ?? []
    // Update the section's properties
    const updated = columns.map((col) =>
      col.id === sectionId ? { ...col, ...updates } : col
    )
    
    // If ranking was updated, re-sort the array by ranking to reflect the new order
    // This ensures the UI displays sections in the correct order
    const sorted = updates.ranking != null 
      ? sortByStringParam([...updated], 'ranking')
      : updated
    
    await prisma.view.update({
      where: { id: view.id },
      data: { board_columns_view: sorted as unknown as Prisma.InputJsonValue }
    })
  }
}

/**
 * Remove a section from all views.
 * Used when deleting (soft-deleting) a section.
 */
export async function removeSectionFromAllViews(sectionId: number, projectId: number) {
  const views = await prisma.view.findMany({
    where: { project_view: { projectId } }
  })
  for (const view of views) {
    const columns = (view.board_columns_view as unknown as ISection[]) ?? []
    const filtered = columns.filter((col) => col.id !== sectionId)
    await prisma.view.update({
      where: { id: view.id },
      data: { board_columns_view: filtered as unknown as Prisma.InputJsonValue }
    })
  }
}
