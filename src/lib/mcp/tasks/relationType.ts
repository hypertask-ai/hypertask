import { buildFieldError } from '@/lib/mcp/fieldError'

export const mcpTaskRelationTypes = [
  'RelatedTo',
  'BlockedBy',
  'BlockedTo',
] as const

export const taskRelationTypeHelp =
  'relation_type is RelatedTo, BlockedBy or BlockedTo'

export function invalidTaskRelationTypeBody() {
  return buildFieldError(
    'invalid_field',
    'relation_type',
    `relation_type must be one of ${mcpTaskRelationTypes.join(', ')}`,
    mcpTaskRelationTypes
  )
}

export type McpTaskRelationType = (typeof mcpTaskRelationTypes)[number]

export function normalizeTaskRelationType(
  value?: unknown
): McpTaskRelationType | null {
  if (value === undefined || value === null) return 'RelatedTo'

  return typeof value === 'string' &&
    mcpTaskRelationTypes.includes(value as McpTaskRelationType)
    ? (value as McpTaskRelationType)
    : null
}
