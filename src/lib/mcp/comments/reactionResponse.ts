interface McpCommentReactionUserRecord {
  id: number
  displayName: string | null
}

export interface McpCommentReactionUser {
  id: number
  displayName?: string
}

/** HTPR-7122: the agent that made a reaction, when the caller may see it. */
export interface McpCommentReactionAgent {
  id?: string
  displayName: string
}

export interface McpCommentReaction {
  id: string
  emoji: string
  /** The person, or for an agent reaction the agent's owner (whose token it used). */
  userId: number
  user?: McpCommentReactionUser
  /** HTPR-7122: true when an agent made it. It is then never the owner's own reaction or approval. */
  isAgent?: true
  agent?: McpCommentReactionAgent
}

interface McpCommentReactionRecord {
  id: string
  emoji: string
  userId: number
  agentId?: string | null
  agentDisplayName?: string | null
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
    agentId: true,
    agentDisplayName: true,
    user: {
      select: {
        id: true,
        displayName: true
      }
    }
  }
}

/** Agent ids the caller may see by name, mapped to their current display name. */
export type VisibleReactionAgents = ReadonlyMap<string, string>

export const PRIVATE_REACTION_AGENT = 'Private agent'

export function mapMcpCommentReaction(
  reaction: McpCommentReactionRecord,
  visibleAgents: VisibleReactionAgents = new Map()
): McpCommentReaction {
  if (reaction.agentId) {
    // Never attach the owner's user object: an agent reaction must not read as the owner's.
    const visibleName = visibleAgents.get(reaction.agentId)
    return {
      id: reaction.id,
      emoji: reaction.emoji,
      userId: reaction.userId,
      isAgent: true,
      agent: visibleName !== undefined
        ? { id: reaction.agentId, displayName: visibleName || reaction.agentDisplayName || 'Agent' }
        : { displayName: PRIVATE_REACTION_AGENT }
    }
  }
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

/** The distinct agent ids behind agent reactions in these comments. */
export function reactionAgentIds(
  comments: ReadonlyArray<{ reactions?: ReadonlyArray<{ agentId?: string | null }> }>
): string[] {
  const ids = new Set<string>()
  for (const comment of comments) {
    for (const reaction of comment.reactions ?? []) {
      if (reaction.agentId) ids.add(reaction.agentId)
    }
  }
  return [...ids]
}
