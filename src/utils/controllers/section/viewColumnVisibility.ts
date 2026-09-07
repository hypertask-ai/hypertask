/**
 * "Show in all views" / "Hide in all views" for one board column (HTPR-5937).
 *
 * Kept free of Prisma and of React so the rule it encodes is directly testable
 * and so the server write and the client cache patch cannot drift apart: both
 * call applyColumnVisibility on the same board_columns_view array shape.
 */
import { buildViewColumnEntry, type NewSectionForView } from './viewColumnEntry'

type ViewColumn = { id?: number; sectionId?: number; visibility?: boolean }

const columnId = (column: ViewColumn) => column.id ?? column.sectionId

/** Column ids are compared, never titles: a rename must not change the answer. */
export const isColumnVisibleInView = (
  columns: readonly ViewColumn[] | null | undefined,
  sectionId: number
): boolean => (columns ?? []).some((column) => columnId(column) === sectionId && column.visibility === true)

/**
 * One view's board_columns_view with this column shown or hidden.
 *
 * Showing a column the view never had appends it, because a view saved before
 * the column existed simply has no entry for it and getProjectSections reads a
 * missing entry as hidden. Hiding keeps the entry and flips the flag, so the
 * rename and reorder helpers still find the column to update.
 */
export const applyColumnVisibility = (
  columns: readonly ViewColumn[] | null | undefined,
  section: NewSectionForView,
  visible: boolean
): ViewColumn[] => {
  const current = columns ?? []
  const present = current.some((column) => columnId(column) === section.id)
  if (!present) {
    return visible ? [...current, buildViewColumnEntry(section) as ViewColumn] : [...current]
  }
  return current.map((column) =>
    columnId(column) === section.id ? { ...column, visibility: visible } : column
  )
}
