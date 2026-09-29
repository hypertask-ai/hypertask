import { parseSearchQuery, parseSearchWithNames, type Names } from './operators'

export async function parseSearchWithChipNames(raw: string, projectIds: number[]) {
  const normalized = raw.replace(/(^|\s)(-?(?:in|board):)#(?=\S)/gi, '$1$2')
  const resolved = await parseSearchWithNames(normalized, projectIds)
  const names: Names = {
    in: resolved.filters.in?.map(({ value }) => value),
    board: resolved.filters.board?.map(({ value }) => value),
  }
  const parsed = parseSearchQuery(raw, names)
  for (const key of ['in', 'board'] as const) {
    for (const filter of parsed.filters[key] ?? []) filter.value = filter.value.replace(/^#/, '')
  }
  return parsed
}
