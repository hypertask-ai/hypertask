export const COMMENT_KINDS = ['question', 'qa', 'done'] as const

export type CommentKind = (typeof COMMENT_KINDS)[number]

export function parseCommentKind(value: unknown): CommentKind | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && COMMENT_KINDS.includes(value as CommentKind)) {
    return value as CommentKind
  }
  throw new Error(`kind must be one of: ${COMMENT_KINDS.join(', ')}`)
}

export function routeComment({ agentId, kind, replyToCommentId, replyToInvocationId, mentionsPerson, flagEnabled }: {
  agentId?: string | null
  kind?: CommentKind
  replyToCommentId?: number
  replyToInvocationId?: number
  mentionsPerson: boolean
  flagEnabled: boolean
}): 'comments' | 'log' {
  return flagEnabled && agentId && kind === undefined &&
    replyToCommentId === undefined && replyToInvocationId === undefined && !mentionsPerson
    ? 'log'
    : 'comments'
}
