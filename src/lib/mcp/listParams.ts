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
