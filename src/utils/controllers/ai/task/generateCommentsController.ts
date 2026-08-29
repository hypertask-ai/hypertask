// Types based on your Prisma model
interface Reaction {
  id: string;
  unified: string;
  size?: number | null;
  emoji: string;
  names: string[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt?: Date | null;
  descriptionId?: string | null;
  commentId?: number | null;
  taskId: number;
  userId: number;
}

// Aggregated reaction data types
interface ReactionGroup {
  emoji: string;
  unified: string;
  count: number;
  userIds: number[];
  names: string[];
}

interface AggregatedReactions {
  totalReactions: number;
  uniqueReactors: number;
  reactionSummary: ReactionGroup[];
  allReactors: number[];
  topReaction: ReactionGroup | null;
  reactionTypes: number;
  hasReactions: boolean;
}

interface ReactionMetadata {
  reaction_count: number;
  unique_reactors: number;
  reaction_types: number;
  top_reaction: string | null;
  top_reaction_count: number;
  has_reactions: boolean;
  reactions_text: string;
  all_reactor_ids: number[];
}

interface DetailedReactionData extends AggregatedReactions {
  reactionBreakdown: Record<string, { count: number; userIds: number[] }>;
  summary: string;
}

interface CommentWithReactions {
  id: number;
  reactions: Reaction[];
  reactionMetadata?: ReactionMetadata;
}

// Function to aggregate reactions for vector DB metadata
function aggregateReactions(reactions?: Reaction[]): AggregatedReactions {
  if (!reactions || reactions.length === 0) {
    return {
      totalReactions: 0,
      uniqueReactors: 0,
      reactionSummary: [],
      allReactors: [],
      topReaction: null,
      reactionTypes: 0,
      hasReactions: false
    };
  }

  // Filter out deleted reactions
  const activeReactions = reactions.filter(reaction => !reaction.isDeleted);
  
  // Group reactions by emoji/unified
  const reactionGroups: Record<string, ReactionGroup> = {};
  const allReactors = new Set<number>();
  
  activeReactions.forEach(reaction => {
    const key = reaction.emoji || reaction.unified; // Use emoji if available, fallback to unified
    
    if (!reactionGroups[key]) {
      reactionGroups[key] = {
        emoji: reaction.emoji,
        unified: reaction.unified,
        count: 0,
        userIds: [],
        names: reaction.names || [] // Store emoji names for search
      };
    }
    
    reactionGroups[key].count++;
    reactionGroups[key].userIds.push(reaction.userId);
    allReactors.add(reaction.userId);
  });
  
  // Convert to array format
  const reactionSummary = Object.values(reactionGroups);
  
  // Sort by count (most popular first)
  reactionSummary.sort((a, b) => b.count - a.count);
  
  return {
    totalReactions: activeReactions.length,
    uniqueReactors: allReactors.size,
    reactionSummary,
    allReactors: Array.from(allReactors),
    // Additional useful metadata for vector DB
    topReaction: reactionSummary[0] || null,
    reactionTypes: reactionSummary.length,
    hasReactions: reactionSummary.length > 0
  };
}

// Simplified version for basic vector DB metadata
function getReactionMetadata(reactions?: Reaction[]): ReactionMetadata {
  const aggregated = aggregateReactions(reactions);
  
  return {
    reaction_count: aggregated.totalReactions,
    unique_reactors: aggregated.uniqueReactors,
    reaction_types: aggregated.reactionTypes,
    top_reaction: aggregated.topReaction?.emoji || null,
    top_reaction_count: aggregated.topReaction?.count || 0,
    has_reactions: aggregated.hasReactions,
    // Reaction breakdown as string for search
    reactions_text: aggregated.reactionSummary
      .map(r => `${r.count} ${r.emoji || r.unified}`)
      .join(', '),
    all_reactor_ids: aggregated.allReactors
  };
}

// Detailed version with full breakdown
function getDetailedReactionData(reactions?: Reaction[]): DetailedReactionData {
  const aggregated = aggregateReactions(reactions);
  
  const reactionBreakdown = aggregated.reactionSummary.reduce((acc, reaction) => {
    const key = reaction.emoji || reaction.unified;
    acc[key] = {
      count: reaction.count,
      userIds: reaction.userIds
    };
    return acc;
  }, {} as Record<string, { count: number; userIds: number[] }>);

  const summary = aggregated.reactionSummary.length > 0 
    ? aggregated.reactionSummary
        .map(r => `${r.count} ${r.emoji || r.names?.[0] || r.unified}`)
        .join(', ')
    : 'No reactions';
  
  return {
    ...aggregated,
    reactionBreakdown,
    summary
  };
}

// Example usage with your comment data
function processCommentReactions(comment: { reactions?: Reaction[] }): ReactionMetadata {
  return getReactionMetadata(comment.reactions);
}


// Export types and functions
export type {
  Reaction,
  ReactionGroup,
  AggregatedReactions,
  ReactionMetadata,
  DetailedReactionData,
  CommentWithReactions,
};

export {
  aggregateReactions,
  getReactionMetadata,
  getDetailedReactionData,
  processCommentReactions,
};