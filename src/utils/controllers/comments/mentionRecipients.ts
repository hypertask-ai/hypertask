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
  if (userId === hyperAiId) return true;
  if (fromAgentId) return false;
  return userId === mentionedBy;
}
