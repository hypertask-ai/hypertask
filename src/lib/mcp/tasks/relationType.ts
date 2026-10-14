export const mcpTaskRelationTypes = [
  'RelatedTo',
  'BlockedBy',
  'BlockedTo',
] as const

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
