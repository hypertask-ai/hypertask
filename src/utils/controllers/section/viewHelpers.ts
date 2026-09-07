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
import { applyColumnVisibility } from './viewColumnVisibility'

/**
 * Read, transform and write board_columns_view for every view of one board,
 * inside a single transaction that holds a row lock on those views.
 *
 * board_columns_view is a whole JSON document, not a set of rows: a snapshot
 * read outside the transaction and written back inside it silently discards
 * whatever rename, reorder or visibility change landed in between, on every
 * view of the board at once. Every writer in this file goes through here, so
 * two column edits on the same board serialize instead of racing (HTPR-5937).
 *
 * `where` narrows which views are written; the lock always covers the whole
 * board, because the writers that do not narrow must still exclude each other.
 */
async function updateBoardViewColumns(
  projectId: number,
  mapColumns: (columns: ISection[]) => unknown[],
  where: Prisma.ViewWhereInput = {}
) {
  // ponytail: one sequential update per view under a board-wide lock. Boards
  // carry tens of views, so the generous window is enough; if a board ever
  // holds hundreds, batch the writes into a single SQL statement rather than
  // raising this further.
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
  await updateBoardViewColumns(projectId, (columns) => [
    ...columns,
    buildViewColumnEntry(section)
  ])
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
  await updateBoardViewColumns(projectId, (columns) => {
    const updated = columns.map((col) =>
      col.id === sectionId ? { ...col, ...updates } : col
    )
    // If ranking was updated, re-sort the array by ranking to reflect the new
    // order. This ensures the UI displays sections in the correct order.
    return updates.ranking !== undefined && updates.ranking !== null
      ? sortByStringParam([...updated], 'ranking')
      : updated
  })
}

/**
 * Remove a section from all views.
 * Used when deleting (soft-deleting) a section.
 */
export async function removeSectionFromAllViews(sectionId: number, projectId: number) {
  await updateBoardViewColumns(projectId, (columns) =>
    columns.filter((col) => col.id !== sectionId)
  )
}

/**
 * Show or hide one section across the board's views (HTPR-5937).
 *
 * The board default view and every named saved view are written, because those
 * are the views the action names. Other people's transient "unsaved" working
 * copies are left alone: a working copy is one person's in-flight private
 * state, and overwriting it would discard a column choice they had not saved.
 * The acting user's own working copy IS written, otherwise the action would
 * appear to do nothing until they switched views.
 */
export async function setSectionVisibilityInAllViews(
  section: { id: number; projectId: number; section_title: string; ranking: string },
  visible: boolean,
  actingUserId: number
) {
  await updateBoardViewColumns(
    section.projectId,
    // Not re-sorted here. Stored entries predating the ranking field would sort
    // against `undefined`, which that comparator treats as equal to everything
    // and scrambles. A column appended by "Show in all views" therefore sits
    // last in the stored array, exactly as a freshly created column does, and
    // the readers place it by Section.ranking.
    (columns) => applyColumnVisibility(columns, section, visible),
    {
      OR: [
        { unsaved_User_Project_View: { none: {} } },
        { unsaved_User_Project_View: { some: { userId: actingUserId } } }
      ]
    }
  )
}
