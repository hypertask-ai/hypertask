export const mcpTaskRelationTypes = [
  'RelatedTo',
  'BlockedBy',
  'BlockedTo',
] as const

export type McpTaskRelationType = (typeof mcpTaskRelationTypes)[number]

export function normalizeTaskRelationType(
  value?: unknown
): McpTaskRelationType | null {
  // Absent OR explicit null defaults to RelatedTo — typed JSON clients often
  // serialize an omitted optional field as null, and both should behave the same.
  if (value === undefined || value === null) return 'RelatedTo'

  return typeof value === 'string' &&
    mcpTaskRelationTypes.includes(value as McpTaskRelationType)
    ? (value as McpTaskRelationType)
    : null
}
