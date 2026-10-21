export type SortOrder = 'asc' | 'desc'

export function parseSortOrderParam(raw: string | null, defaultValue: SortOrder): SortOrder | null {
  if (raw === null || raw.trim() === '') return defaultValue
  const value = raw.trim().toLowerCase()
  return value === 'asc' || value === 'desc' ? value : null
}

export function findParamWithNulByte(searchParams: URLSearchParams): string | null {
  for (const [key, value] of searchParams) {
    if (key.includes('\0') || value.includes('\0')) return key.replaceAll('\0', '')
  }
  return null
}

const DATABASE_INT_MAX = 2_147_483_647

type IdParamValue = number | readonly number[] | null | undefined

export function findIdParamOutOfRange(params: Record<string, IdParamValue>): string | null {
  for (const [name, value] of Object.entries(params)) {
    const ids: readonly number[] = Array.isArray(value) ? value : typeof value === 'number' ? [value] : []
    if (ids.some((id) => Math.abs(id) > DATABASE_INT_MAX)) return name
  }
  return null
}

export function idOutOfRangeMessage(name: string): string {
  return `${name} is too large; ids go up to ${DATABASE_INT_MAX}`
}
