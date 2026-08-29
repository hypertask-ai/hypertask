interface McpCommentReactionUserRecord {
  id: number
  displayName: string | null
}

export interface McpCommentReactionUser {
  id: number
  displayName?: string
}

export interface McpCommentReaction {
  id: string
  emoji: string
  userId: number
  user?: McpCommentReactionUser
}

interface McpCommentReactionRecord {
  id: string
  emoji: string
  userId: number
  user?: McpCommentReactionUserRecord | null
}

export const commentReactionInclude = {
  where: {
    isDeleted: false
  },
  select: {
    id: true,
    emoji: true,
    userId: true,
    user: {
      select: {
        id: true,
        displayName: true
      }
    }
  }
}

export function mapMcpCommentReaction(
  reaction: McpCommentReactionRecord
): McpCommentReaction {
  const displayName = reaction.user?.displayName
  return {
    id: reaction.id,
    emoji: reaction.emoji,
    userId: reaction.userId,
    ...(reaction.user
      ? {
          user: {
            id: reaction.user.id,
            ...(displayName !== null && displayName !== undefined
              ? { displayName }
              : {})
          }
        }
      : {})
  }
}
