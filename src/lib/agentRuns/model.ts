import type {
  AgentRun,
  AgentRunStatus,
  AgentRunTrigger,
} from "@prisma/client";
import type {
  AgentWebhookEventInput,
  AgentWebhookRun,
} from "@/lib/agentWebhooks/events";

export const AGENT_RUN_FEATURE_FLAG = "htpr-6115-agent-sdk";
export const AGENT_RUN_STALE_AFTER_MS = 5 * 60 * 1000;
export const NONTERMINAL_AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "ACTIVE",
  "STALE",
];

export type AgentRunContext =
  | { taskId: number; chatSessionId: null }
  | { taskId: null; chatSessionId: string };

export function agentRunTriggerForEvent(
  event: AgentWebhookEventInput["event"],
): AgentRunTrigger | null {
  if (event === "comment.mention") return "MENTION";
  if (event === "task.assigned") return "ASSIGNED";
  if (event === "chat.message") return "CHAT";
  return null;
}

export function agentRunContextForEvent(
  input: AgentWebhookEventInput,
): AgentRunContext | null {
  if (input.event === "chat.message" && input.chat?.sessionId) {
    return { taskId: null, chatSessionId: input.chat.sessionId };
  }
  if (
    (input.event === "comment.mention" || input.event === "task.assigned") &&
    input.taskId !== null
  ) {
    return { taskId: input.taskId, chatSessionId: null };
  }
  return null;
}

export function agentRunPromptForEvent(
  input: AgentWebhookEventInput,
): string | null {
  if (input.event === "comment.mention") return input.commentHtml ?? null;
  if (input.event === "chat.message") return input.chat?.text ?? null;
  return null;
}

export function serializeAgentRun(
  run: Pick<
    AgentRun,
    | "id"
    | "agentId"
    | "taskId"
    | "chatSessionId"
    | "trigger"
    | "status"
    | "createdAt"
    | "lastActivityAt"
    | "stoppedById"
  >,
): AgentWebhookRun {
  return {
    id: run.id,
    agentId: run.agentId,
    taskId: run.taskId,
    chatSessionId: run.chatSessionId,
    trigger: run.trigger.toLowerCase() as AgentWebhookRun["trigger"],
    status: run.status.toLowerCase() as AgentWebhookRun["status"],
    createdAt: run.createdAt.toISOString(),
    lastActivityAt: run.lastActivityAt.toISOString(),
    stoppedBy: run.stoppedById,
  };
}
