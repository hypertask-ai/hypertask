
export function isAgentAction(
  fromAgentId?: string | null,
  agentAssignerId?: string | null
): boolean {
  return (
    (typeof fromAgentId === "string" && fromAgentId.length > 0) ||
    (typeof agentAssignerId === "string" && agentAssignerId.length > 0)
  );
}

export function includeSenderInRecipients(
  fromAgentId?: string | null
): boolean {
  return typeof fromAgentId === "string" && fromAgentId.length > 0;
}

export function shouldSkipSelfAssign(
  assigneeUserId: number,
  currentUserId: number,
  agentAssignerId?: string | null
): boolean {
  if (isAgentAction(undefined, agentAssignerId)) return false;
  return assigneeUserId === currentUserId;
}

export function shouldExcludeCommentCreator(
  recipientUserId: number,
  creatorId: number,
  fromAgentId?: string | null
): boolean {
  if (includeSenderInRecipients(fromAgentId)) return false;
  return recipientUserId === creatorId;
}

export function shouldNotifyTaskOwnerForComment(
  creatorId: number,
  taskOwnerId: number,
  fromAgentId?: string | null
): boolean {
  if (includeSenderInRecipients(fromAgentId)) return true;
  return creatorId !== taskOwnerId;
}
