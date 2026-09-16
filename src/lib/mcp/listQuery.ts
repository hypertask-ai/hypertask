/**
 * Shared list/search query contract for MCP tools and the REST routes
 * that back them (HTPR-6530). Same names everywhere: query, filter, sort,
 * fields, limit, cursor.
 */

export const LIST_FILTER_KEYS = [
  'section',
  'label',
  'assignee',
  'status',
  'updated_since',
  'has_pr',
] as const

export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number]

export type ListFilter = {
  section?: string
  label?: string | string[]
  assignee?: string | number
  status?: string
  updated_since?: string
  has_pr?: string
}

export type ParsedListQuery = {
  query?: string
  filter: ListFilter
  sort?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  fields: string[]
  limit?: number
  cursor?: string
}

export const HAS_PR_VALUES = [
  'red',
  'failing',
  'checks_red',
  'true',
  'yes',
  'false',
  'no',
  'none',
  'open',
  'green',
  'passing',
  'merged',
] as const

export type HasPrValue = (typeof HAS_PR_VALUES)[number]

export type TaskStatusValue = 'Normal' | 'Archive' | 'Deleted'

export type AssigneeFilter =
  | { ok: true; kind: 'me' | 'unassigned' }
  | { ok: true; kind: 'ids'; userIds: number[] }
  | { ok: false; error: string }

export class ListQueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ListQueryParseError'
  }
}

/** When the client asked for a projection and no limit, keep the page small enough for a 2 KB payload. */
export const FIELDS_DEFAULT_LIMIT = 20

export function normalizeTaskStatus(value?: string | null): TaskStatusValue | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'open' || normalized === 'active' || normalized === 'normal') return 'Normal'
  if (normalized === 'archive' || normalized === 'archived') return 'Archive'
  if (normalized === 'deleted' || normalized === 'delete') return 'Deleted'
  return null
}

export function resolveListLimit(listQuery: ParsedListQuery, fallback: number, max = 100): number {
  if (listQuery.limit) return Math.min(listQuery.limit, max)
  if (listQuery.fields.length > 0) return Math.min(FIELDS_DEFAULT_LIMIT, max)
  return Math.min(fallback, max)
}

export function parseSort(
  sort?: string | null,
): { sortBy?: string; sortOrder?: 'asc' | 'desc' } {
  if (!sort) return {}
  const trimmed = sort.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('-')) {
    return { sortBy: trimmed.slice(1), sortOrder: 'desc' }
  }
  const colon = trimmed.lastIndexOf(':')
  if (colon > 0) {
    const field = trimmed.slice(0, colon)
    const dir = trimmed.slice(colon + 1).toLowerCase()
    if (dir === 'asc' || dir === 'desc') {
      return { sortBy: field, sortOrder: dir }
    }
  }
  return { sortBy: trimmed, sortOrder: 'asc' }
}

export function parseFields(raw?: string | string[] | null): string[] {
  if (!raw) return []
  const parts = Array.isArray(raw) ? raw.flatMap((item) => item.split(',')) : raw.split(',')
  return parts.map((part) => part.trim()).filter(Boolean)
}

function asStringArray(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseFilterValue(raw: unknown): ListFilter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const input = raw as Record<string, unknown>
  const filter: ListFilter = {}
  if (typeof input.section === 'string' && input.section.trim()) {
    filter.section = input.section.trim()
  }
  const labels = asStringArray(input.label)
  if (labels.length === 1) filter.label = labels[0]
  else if (labels.length > 1) filter.label = labels
  if (input.assignee !== undefined && input.assignee !== null && input.assignee !== '') {
    filter.assignee = typeof input.assignee === 'number' ? input.assignee : String(input.assignee)
  }
  if (typeof input.status === 'string' && input.status.trim()) {
    filter.status = normalizeTaskStatus(input.status) ?? input.status.trim()
  }
  if (typeof input.updated_since === 'string' && input.updated_since.trim()) {
    filter.updated_since = input.updated_since.trim()
  }
  if (typeof input.has_pr === 'string' && input.has_pr.trim()) {
    filter.has_pr = input.has_pr.trim()
  } else if (typeof input.has_pr === 'boolean') {
    filter.has_pr = input.has_pr ? 'true' : 'false'
  }
  return filter
}

function parseFilterParam(raw: string | null): ListFilter {
  if (!raw) return {}
  const trimmed = raw.trim()
  if (!trimmed) return {}
  if (!trimmed.startsWith('{')) {
    throw new ListQueryParseError('filter must be a JSON object')
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ListQueryParseError('filter must be a JSON object')
    }
    return parseFilterValue(parsed)
  } catch (error) {
    if (error instanceof ListQueryParseError) throw error
    throw new ListQueryParseError('filter must be valid JSON')
  }
}

export function parseAssigneeFilter(value: string | number | undefined): AssigneeFilter {
  if (value === undefined || value === '') {
    return { ok: false, error: 'filter.assignee must be me, unassigned, or a positive user id' }
  }
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) {
      return { ok: true, kind: 'ids', userIds: [value] }
    }
    return { ok: false, error: 'filter.assignee must be me, unassigned, or a positive user id' }
  }
  const trimmed = value.trim()
  const keyword = trimmed.toLowerCase()
  if (keyword === 'me' || keyword === 'unassigned') {
    return { ok: true, kind: keyword }
  }
  const userIds = trimmed.split(',').map((part) => Number(part.trim()))
  if (userIds.length === 0 || userIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return {
      ok: false,
      error: 'filter.assignee must be me, unassigned, or a comma-separated list of user ids',
    }
  }
  return { ok: true, kind: 'ids', userIds }
}

export function parseUpdatedSince(value?: string | null): Date | null {
  if (!value?.trim()) return null
  const time = Date.parse(value.trim())
  return Number.isNaN(time) ? null : new Date(time)
}

export function parseNumericCursor(cursor?: string | null): number | null {
  if (!cursor?.trim()) return null
  const trimmed = cursor.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const id = Number(trimmed)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function assertKnownFilters(filter: ListFilter): void {
  if (filter.assignee !== undefined) {
    const parsed = parseAssigneeFilter(filter.assignee)
    if (!parsed.ok) throw new ListQueryParseError(parsed.error)
  }
  if (filter.updated_since && !parseUpdatedSince(filter.updated_since)) {
    throw new ListQueryParseError('filter.updated_since must be an ISO datetime')
  }
  if (filter.has_pr && !normalizeHasPr(filter.has_pr)) {
    throw new ListQueryParseError(
      'filter.has_pr must be red, failing, true, false, open, green, or merged',
    )
  }
}

export function parseListQueryFromSearchParams(searchParams: URLSearchParams): ParsedListQuery {
  const filter = {
    ...parseFilterParam(searchParams.get('filter')),
  }
  for (const key of LIST_FILTER_KEYS) {
    const dotted = searchParams.getAll(`filter.${key}`)
    if (dotted.length === 0) continue
    if (key === 'label') {
      filter.label = dotted.length === 1 ? dotted[0] : dotted
    } else if (key === 'assignee') {
      filter.assignee = dotted[dotted.length - 1]
    } else {
      filter[key] = dotted[dotted.length - 1]
    }
  }

  const mergedFields = parseFields(searchParams.getAll('fields'))

  const sort = searchParams.get('sort') ?? undefined
  const parsedSort = parseSort(sort)
  const limitRaw = searchParams.get('limit')
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined
  assertKnownFilters(filter)

  return {
    query: searchParams.get('query')?.trim() || undefined,
    filter,
    sort: sort || undefined,
    sortBy: parsedSort.sortBy,
    sortOrder: parsedSort.sortOrder,
    fields: mergedFields,
    limit: limit && limit > 0 ? Math.min(limit, 100) : undefined,
    cursor: searchParams.get('cursor')?.trim() || undefined,
  }
}

export function parseListQueryFromArgs(args: Record<string, unknown> | null | undefined): ParsedListQuery {
  const input = args ?? {}
  const sort = typeof input.sort === 'string' ? input.sort : undefined
  const parsedSort = parseSort(sort)
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : undefined
  const filter = parseFilterValue(input.filter)
  assertKnownFilters(filter)
  return {
    query: typeof input.query === 'string' && input.query.trim() ? input.query.trim() : undefined,
    filter,
    sort,
    sortBy: parsedSort.sortBy,
    sortOrder: parsedSort.sortOrder,
    fields: parseFields(input.fields as string | string[] | undefined),
    limit: limit && limit > 0 ? Math.min(limit, 100) : undefined,
    cursor: typeof input.cursor === 'string' && input.cursor.trim() ? input.cursor.trim() : undefined,
  }
}

export function appendListQueryParams(
  params: URLSearchParams,
  input: {
    query?: string
    filter?: ListFilter
    sort?: string
    fields?: string | string[]
    limit?: number
    cursor?: string
  },
): void {
  if (input.query) params.set('query', input.query)
  if (input.filter && Object.keys(input.filter).length > 0) {
    params.set('filter', JSON.stringify(input.filter))
  }
  if (input.sort) params.set('sort', input.sort)
  const fields = parseFields(input.fields)
  if (fields.length > 0) params.set('fields', fields.join(','))
  if (input.limit !== undefined) params.set('limit', String(input.limit))
  if (input.cursor) params.set('cursor', input.cursor)
}

export function normalizeHasPr(value?: string | null): HasPrValue | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  return (HAS_PR_VALUES as readonly string[]).includes(normalized)
    ? (normalized as HasPrValue)
    : null
}

export function hasPrWhere(hasPr?: string | null): Record<string, unknown> | null {
  const value = normalizeHasPr(hasPr)
  if (!value) return null
  if (value === 'true' || value === 'yes') return { pullRequests: { some: {} } }
  if (value === 'false' || value === 'no' || value === 'none') {
    return { pullRequests: { none: {} } }
  }
  if (value === 'red' || value === 'failing' || value === 'checks_red') {
    return { pullRequests: { some: { checkState: 'failing' } } }
  }
  if (value === 'green' || value === 'passing') {
    return { pullRequests: { some: { checkState: 'passing' } } }
  }
  if (value === 'open') return { pullRequests: { some: { lifecycle: 'open' } } }
  if (value === 'merged') return { pullRequests: { some: { lifecycle: 'merged' } } }
  return null
}

function pickPath(row: Record<string, unknown>, field: string): unknown {
  if (field === 'url') {
    if (typeof row.url === 'string') return row.url
    const link = row.link
    if (link && typeof link === 'object' && 'url' in link) {
      return (link as { url?: unknown }).url
    }
    return undefined
  }
  if (field.includes('.')) {
    return field.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as Record<string, unknown>)[part]
    }, row)
  }
  return row[field]
}

export function projectRows(
  rows: ReadonlyArray<object>,
  fields: string[],
): Array<Record<string, unknown>>
export function projectRows<T extends Record<string, unknown>>(
  rows: T[],
  fields: string[],
): Array<Record<string, unknown>> {
  if (fields.length === 0) return rows
  return rows.map((row) => {
    const projected: Record<string, unknown> = {}
    for (const field of fields) {
      const value = pickPath(row as Record<string, unknown>, field)
      if (value !== undefined) projected[field] = value
    }
    return projected
  })
}

function stringifySearchable(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function compareSortValues(left: unknown, right: unknown): number {
  const leftNumber = asFiniteNumber(left)
  const rightNumber = asFiniteNumber(right)
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
  const a = stringifySearchable(left)
  const b = stringifySearchable(right)
  return a < b ? -1 : a > b ? 1 : 0
}

export function applyCollectionQuery(
  items: object[],
  listQuery: ParsedListQuery,
  options?: { searchFields: string[]; idField?: string },
): { items: Array<Record<string, unknown>>; total: number; nextCursor: string | null }
export function applyCollectionQuery<T extends Record<string, unknown>>(
  items: T[],
  listQuery: ParsedListQuery,
  options: { searchFields: string[]; idField?: string } = { searchFields: [] },
): { items: Array<Record<string, unknown>>; total: number; nextCursor: string | null } {
  const idField = options.idField ?? 'id'
  let filtered = items.slice()

  if (listQuery.query) {
    const needle = listQuery.query.toLowerCase()
    filtered = filtered.filter((item) =>
      options.searchFields.some((field) =>
        stringifySearchable((item as Record<string, unknown>)[field]).toLowerCase().includes(needle),
      ),
    )
  }

  if (listQuery.filter.status) {
    const status = normalizeTaskStatus(listQuery.filter.status) ?? listQuery.filter.status
    filtered = filtered.filter((item) => {
      const raw = String((item as Record<string, unknown>).status ?? '')
      const itemStatus = normalizeTaskStatus(raw) ?? raw
      return itemStatus === status
    })
  }
  if (listQuery.filter.section) {
    const section = listQuery.filter.section.toLowerCase()
    filtered = filtered.filter((item) => {
      const value = (item as Record<string, unknown>).section
        ?? (item as Record<string, unknown>).section_title
        ?? (item as Record<string, unknown>).title
      return String(value ?? '').toLowerCase() === section
    })
  }
  if (listQuery.filter.updated_since) {
    const since = Date.parse(listQuery.filter.updated_since)
    if (!Number.isNaN(since)) {
      filtered = filtered.filter((item) => {
        const raw = (item as Record<string, unknown>).updatedAt
          ?? (item as Record<string, unknown>).createdAt
        const time = typeof raw === 'string' || raw instanceof Date ? Date.parse(String(raw)) : NaN
        return !Number.isNaN(time) && time >= since
      })
    }
  }

  if (listQuery.sortBy) {
    const dir = listQuery.sortOrder === 'desc' ? -1 : 1
    const key = listQuery.sortBy
    filtered.sort((left, right) => {
      return (
        compareSortValues(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ) * dir
      )
    })
  }

  const total = filtered.length
  if (listQuery.cursor) {
    const index = filtered.findIndex(
      (item) => String((item as Record<string, unknown>)[idField]) === listQuery.cursor,
    )
    if (index < 0) {
      throw new ListQueryParseError('cursor must be a previous nextCursor value')
    }
    filtered = filtered.slice(index + 1)
  }

  const limit = listQuery.limit ?? filtered.length
  const page = filtered.slice(0, limit)
  const nextCursor =
    page.length === limit && filtered.length > limit
      ? String((page[page.length - 1] as Record<string, unknown>)[idField] ?? '')
      : null

  return {
    items: projectRows(page as Array<Record<string, unknown>>, listQuery.fields),
    total,
    nextCursor: nextCursor || null,
  }
}

export function taskUrlFromListItem(task: {
  ticketNumber?: string | null
  projectId?: number | null
  uniqueIndex?: number | null
  url?: string
}): string | undefined {
  if (task.url) return task.url
  const uniqueIndex =
    task.uniqueIndex ??
    (task.ticketNumber ? Number(String(task.ticketNumber).split('-').pop()) : NaN)
  if (!task.projectId || !Number.isFinite(uniqueIndex) || uniqueIndex <= 0) return undefined
  return `https://app.hypertask.ai/detail/project-${task.projectId}/${uniqueIndex}`
}

export type TaskLinkInfo = {
  url: string
  format: string
  example: string
}

export function taskLinkFromListItem(task: {
  ticketNumber?: string | null
  projectId?: number | null
  uniqueIndex?: number | null
}): TaskLinkInfo | undefined {
  const url = taskUrlFromListItem(task)
  if (!url || !task.projectId) return undefined
  return {
    url,
    format: 'https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}',
    example: url,
  }
}

export function withTaskPresentation<T extends {
  ticketNumber?: string | null
  projectId?: number | null
  uniqueIndex?: number | null
  url?: string
  link?: TaskLinkInfo
}>(task: T): T & { url?: string; link?: TaskLinkInfo } {
  const url = taskUrlFromListItem(task)
  const link = taskLinkFromListItem(task)
  return {
    ...task,
    ...(url ? { url } : {}),
    ...(link ? { link } : {}),
  }
}
