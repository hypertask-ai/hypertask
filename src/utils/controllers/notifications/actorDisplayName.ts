type ActorLike = {
  displayName?: string | null;
};

type NotificationActor = {
  fromAgent?: ActorLike | null;
  fromUser?: ActorLike | null;
};

export function notificationActorName(
  actor: NotificationActor,
  fallback = "Someone",
): string {
  return (
    actor.fromAgent?.displayName?.trim() ||
    actor.fromUser?.displayName?.trim() ||
    fallback
  );
}

export function mentionAuthorAgentId(
  fromAgentId: string | null | undefined,
  comment: { agentId: string | null } | null,
): string | null {
  return comment ? comment.agentId : fromAgentId ?? null;
}
