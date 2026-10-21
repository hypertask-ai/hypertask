interface McpCommentReactionUserRecord {
  id: number
  displayName: string | null
}

export interface McpCommentReactionUser {
  id: number
  displayName?: string
}

export interface McpCommentReactionAgent {
  id?: string
  displayName: string
}

export interface McpCommentReaction {
  createdAt: string
  id: string
  emoji: string
  userId: number
  user?: McpCommentReactionUser
  isAgent?: true
  agent?: McpCommentReactionAgent
}

interface McpCommentReactionRecord {
  createdAt: Date
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
    createdAt: true,
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

export type VisibleReactionAgents = ReadonlyMap<string, string>

export const PRIVATE_REACTION_AGENT = 'Private agent'

export function mapMcpCommentReaction(
  reaction: McpCommentReactionRecord,
  visibleAgents: VisibleReactionAgents = new Map()
): McpCommentReaction {
  if (reaction.agentId) {
    const visibleName = visibleAgents.get(reaction.agentId)
    return {
      id: reaction.id,
      createdAt: reaction.createdAt.toISOString(),
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
    createdAt: reaction.createdAt.toISOString(),
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

export async function mapReactionWriteResult<
  T extends { reaction: McpCommentReactionRecord | null; reactions: McpCommentReactionRecord[] }
>(
  result: T,
  loadVisibleAgents: (agentIds: string[]) => Promise<VisibleReactionAgents>
): Promise<Omit<T, 'reaction' | 'reactions'> & { reaction: McpCommentReaction | null; reactions: McpCommentReaction[] }> {
  let visibleAgents: VisibleReactionAgents = new Map()
  try {
    visibleAgents = await loadVisibleAgents(reactionAgentIds([{ reactions: result.reactions }]))
  } catch (error) {
    console.error('[comment-reaction] agent visibility lookup failed', error)
  }
  return {
    ...result,
    reaction: result.reaction && mapMcpCommentReaction(result.reaction, visibleAgents),
    reactions: result.reactions.map((row) => mapMcpCommentReaction(row, visibleAgents)),
  }
}

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
