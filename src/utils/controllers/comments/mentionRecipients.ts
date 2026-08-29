/**
 * Who a mention should NOT notify.
 *
 * HTPR-4229: a comment posted through an agent's MCP token is attributed to the
 * token's OWNER, so `mentionedBy` is the human who owns the bot rather than the
 * author. Skipping `userId === mentionedBy` therefore meant an agent could never
 * notify its own owner — the case that matters most, since agents almost always
 * mention the person running them. The agent is a different actor from its
 * owner, so self-mention suppression does not apply when one posted.
 *
 * Lives in its own module with no imports: processMentions pulls in FCM and
 * Firebase Admin at import time, which makes the rule untestable from there.
 */
export function shouldSkipMentionRecipient({
  userId,
  mentionedBy,
  hyperAiId,
  fromAgentId,
}: {
  userId: number;
  mentionedBy: number;
  hyperAiId: number;
  fromAgentId?: string | null;
}): boolean {
  // Not a person with an inbox, and notifying it is how agents end up looping.
  if (userId === hyperAiId) return true;
  if (fromAgentId) return false;
  return userId === mentionedBy;
}
