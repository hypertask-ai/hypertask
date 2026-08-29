export const SLACK_CREATE_TASK_INTENT_PATTERN =
  /(create|make|add|open|write)\b.*\b(task|ticket)/i;

export const SLACK_DEFAULT_PROJECT_REPLY =
  "Ask the admin who connected Hypertask to set a default project in Settings → Slack, then try again.";

export function hasSlackCreateTaskIntent(text: string): boolean {
  return SLACK_CREATE_TASK_INTENT_PATTERN.test(text);
}

export function missingSlackDefaultProjectReply(
  defaultProjectId: number | null,
): string | null {
  return defaultProjectId === null ? SLACK_DEFAULT_PROJECT_REPLY : null;
}

export function slackCreateProjectWhere(
  defaultProjectId: number,
  teamId: string,
) {
  return {
    id: defaultProjectId,
    status: "Normal" as const,
    teamId,
  };
}

type SlackEventReceiptClient = {
  slackEventReceipt: {
    create(args: { data: { eventId: string } }): Promise<unknown>;
  };
};

export async function claimSlackEventOnce(
  client: SlackEventReceiptClient,
  eventId: string,
): Promise<boolean> {
  try {
    await client.slackEventReceipt.create({ data: { eventId } });
    return true;
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) return false;
    throw error;
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002",
  );
}
