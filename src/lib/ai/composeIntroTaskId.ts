const COMPOSE_INTRO_ID = /^compose-task-(\d+)$/;

export function composeIntroTaskId(messageId: string | undefined): number | undefined {
  const match = COMPOSE_INTRO_ID.exec(messageId ?? "");
  if (!match) return undefined;
  return Number(match[1]);
}
