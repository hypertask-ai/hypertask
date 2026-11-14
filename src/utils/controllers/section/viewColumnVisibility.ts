import { buildViewColumnEntry, type NewSectionForView } from './viewColumnEntry'

type ViewColumn = { id?: number; sectionId?: number; visibility?: boolean }

const columnId = (column: ViewColumn) => column.id ?? column.sectionId

export const isColumnVisibleInView = (
  columns: readonly ViewColumn[] | null | undefined,
  sectionId: number
): boolean => (columns ?? []).some((column) => columnId(column) === sectionId && column.visibility === true)

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

export const viewColumnsToWrite = <T>(
  incoming: unknown,
  fallback?: readonly T[] | null
): T[] | null => {
  if (Array.isArray(incoming) && incoming.length > 0) return incoming as T[]
  const backup = Array.isArray(fallback) ? [...fallback] : []
  return backup.length > 0 ? backup : null
}
