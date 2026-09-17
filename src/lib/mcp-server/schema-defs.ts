export const SHARED_SCHEMA_DEFS = {
  priorityIndex: {
    type: 'integer',
    minimum: 0,
    maximum: 4,
    description: '0=None, 1=Urgent, 2=High, 3=Medium, 4=Low',
  },
  priorityName: {
    type: 'string',
    enum: ['None', 'Urgent', 'High', 'Medium', 'Low'],
  },
  priorityNameRequired: {
    type: 'string',
    enum: ['Urgent', 'High', 'Medium', 'Low'],
  },
  taskStatus: {
    type: 'string',
    enum: ['Normal', 'Archive', 'Deleted'],
  },
  contentType: {
    type: 'string',
    enum: ['markdown', 'html'],
  },
  visibility: {
    type: 'string',
    enum: ['Public', 'Private'],
  },
  sortOrder: {
    type: 'string',
    enum: ['asc', 'desc'],
  },
} as const

const ENUM_REFS: Array<{ values: readonly string[]; ref: string }> = [
  { values: ['None', 'Urgent', 'High', 'Medium', 'Low'], ref: '#/$defs/priorityName' },
  { values: ['Urgent', 'High', 'Medium', 'Low'], ref: '#/$defs/priorityNameRequired' },
  { values: ['Normal', 'Archive', 'Deleted'], ref: '#/$defs/taskStatus' },
  { values: ['markdown', 'html'], ref: '#/$defs/contentType' },
  { values: ['Public', 'Private'], ref: '#/$defs/visibility' },
  { values: ['asc', 'desc'], ref: '#/$defs/sortOrder' },
]

function sameEnum(left: unknown, right: readonly string[]): boolean {
  if (!Array.isArray(left) || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function replaceDuplicatedEnums(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => replaceDuplicatedEnums(item))
  }
  if (!node || typeof node !== 'object') return node

  const record = node as Record<string, unknown>
  if (record.type === 'integer' && record.minimum === 0 && record.maximum === 4) {
    return { $ref: '#/$defs/priorityIndex' }
  }

  const match = ENUM_REFS.find((candidate) => sameEnum(record.enum, candidate.values))
  if (match && record.type === 'string') {
    return { $ref: match.ref }
  }

  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === '$defs') {
      next[key] = value
      continue
    }
    next[key] = replaceDuplicatedEnums(value)
  }
  return next
}

export function withSharedDefs(schema: Record<string, unknown>): Record<string, unknown> {
  const replaced = replaceDuplicatedEnums(schema) as Record<string, unknown>
  const existing =
    replaced.$defs && typeof replaced.$defs === 'object' && !Array.isArray(replaced.$defs)
      ? (replaced.$defs as Record<string, unknown>)
      : {}
  return {
    ...replaced,
    $defs: {
      ...SHARED_SCHEMA_DEFS,
      ...existing,
    },
  }
}

export const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const
