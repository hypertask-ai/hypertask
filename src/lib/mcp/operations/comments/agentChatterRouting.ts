export const COMMENT_KINDS = ['question', 'qa', 'done'] as const

export type CommentKind = (typeof COMMENT_KINDS)[number]

export function parseCommentKind(value: unknown): CommentKind | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && COMMENT_KINDS.includes(value as CommentKind)) {
    return value as CommentKind
  }
  throw new Error(`kind must be one of: ${COMMENT_KINDS.join(', ')}`)
}

export function routeComment({ agentId, kind, legacy }: {
  agentId?: string | null
  kind?: CommentKind
  legacy?: { flagEnabled: boolean; replyToCommentId?: number; replyToInvocationId?: number; mentionsPerson: boolean; hasImages: boolean }
}): 'comments' | 'log' {
  if (legacy?.flagEnabled) {
    return agentId && kind === undefined && legacy.replyToCommentId === undefined &&
      legacy.replyToInvocationId === undefined && !legacy.mentionsPerson && !legacy.hasImages
      ? 'log'
      : 'comments'
  }
  return agentId && kind === undefined ? 'log' : 'comments'
}
