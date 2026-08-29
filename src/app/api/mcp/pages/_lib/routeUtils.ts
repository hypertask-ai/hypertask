import type { McpAuthContext } from '@/lib/mcp/auth'
import { buildFieldError } from '@/lib/mcp/fieldError'
import { validateProjectAccess } from '@/lib/mcp/tasks/services'

export type PageIdentifier =
  | { id: number; publicId?: never }
  | { publicId: string; id?: never }

export function isRequestBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null
  }

  return value
}

export function parsePageIdentifier(value: unknown): PageIdentifier | null {
  if (typeof value === 'number') {
    const id = parsePositiveInteger(value)
    return id === null ? null : { id }
  }

  if (typeof value !== 'string') return null

  const identifier = value.trim()
  if (!identifier) return null

  if (/^\d+$/.test(identifier)) {
    const id = Number(identifier)
    return Number.isSafeInteger(id) && id > 0 ? { id } : null
  }

  return { publicId: identifier }
}

type PageIdentifierAliasResult =
  | { identifier: PageIdentifier; field: 'id' | 'page_id' }
  | { error: ReturnType<typeof buildFieldError> }

export function resolvePageIdentifierAlias(
  source: { id?: unknown; page_id?: unknown } | URLSearchParams
): PageIdentifierAliasResult {
  const isQuery = source instanceof URLSearchParams
  const hasId = isQuery
    ? source.has('id')
    : Object.prototype.hasOwnProperty.call(source, 'id')
  const hasPageId = isQuery
    ? source.has('page_id')
    : Object.prototype.hasOwnProperty.call(source, 'page_id')

  if (!hasId && !hasPageId) {
    return {
      error: buildFieldError(
        'missing_field',
        'id',
        'Provide page_id or id; both field names are accepted'
      ),
    }
  }

  const rawId = isQuery ? source.get('id') : source.id
  const rawPageId = isQuery ? source.get('page_id') : source.page_id
  const id = hasId ? parsePageIdentifier(rawId) : null
  const pageId = hasPageId ? parsePageIdentifier(rawPageId) : null

  if (hasId && !id) {
    return {
      error: buildFieldError(
        'invalid_field',
        'id',
        'id must be a page publicId or positive numeric ID'
      ),
    }
  }

  if (hasPageId && !pageId) {
    return {
      error: buildFieldError(
        'invalid_field',
        'page_id',
        'id must be a page publicId or positive numeric ID'
      ),
    }
  }

  if (hasId && hasPageId) {
    const identifiersMatch =
      ('id' in id! && 'id' in pageId! && id.id === pageId.id) ||
      ('publicId' in id! &&
        'publicId' in pageId! &&
        id.publicId === pageId.publicId)

    if (!identifiersMatch) {
      return {
        error: buildFieldError(
          'invalid_field',
          'page_id',
          'page_id and id must identify the same page when both are provided'
        ),
      }
    }
  }

  return {
    identifier: (id ?? pageId)!,
    field: hasId ? 'id' : 'page_id',
  }
}

export async function canAccessProject(
  projectId: number,
  ctx: McpAuthContext
): Promise<boolean> {
  const projectCheck = await validateProjectAccess(
    projectId,
    ctx.user.id,
    ctx.agentId
  )

  return projectCheck.error === null
}

export function getPageUrl(publicId: string): string {
  return `${process.env.NEXT_PUBLIC_BASEURL}/page/${publicId}`
}
