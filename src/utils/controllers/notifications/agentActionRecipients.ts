/**
 * When an agent acts on behalf of a user (MCP or UI with fromAgentId / agentAssignerId),
 * relax self-skip rules so involved users—including the agent owner—receive inbox notifications.
 */

export function isAgentAction(
  fromAgentId?: string | null,
  agentAssignerId?: string | null
): boolean {
  return (
    (typeof fromAgentId === "string" && fromAgentId.length > 0) ||
    (typeof agentAssignerId === "string" && agentAssignerId.length > 0)
  );
}

/** Include sender/creator in task-update recipient lists when an agent performed the action. */
export function includeSenderInRecipients(
  fromAgentId?: string | null
): boolean {
  return typeof fromAgentId === "string" && fromAgentId.length > 0;
}

/** Skip self-assign notification only for plain user actions, not agent-initiated assigns. */
export function shouldSkipSelfAssign(
  assigneeUserId: number,
  currentUserId: number,
  agentAssignerId?: string | null
): boolean {
  if (isAgentAction(undefined, agentAssignerId)) return false;
  return assigneeUserId === currentUserId;
}

/** Skip notifying comment creator as assignee/follower only for plain user comments. */
export function shouldExcludeCommentCreator(
  recipientUserId: number,
  creatorId: number,
  fromAgentId?: string | null
): boolean {
  if (includeSenderInRecipients(fromAgentId)) return false;
  return recipientUserId === creatorId;
}

/** Notify task owner about a comment when creator is not owner, or when an agent acted. */
export function shouldNotifyTaskOwnerForComment(
  creatorId: number,
  taskOwnerId: number,
  fromAgentId?: string | null
): boolean {
  if (includeSenderInRecipients(fromAgentId)) return true;
  return creatorId !== taskOwnerId;
}
