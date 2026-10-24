import type { Prisma } from "@prisma/client";

export function agentChatContextPayload(
  text: string,
  context: Prisma.JsonValue | undefined,
) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return { text };
  }
  const label = context.scope === "ticket"
    ? `${context.ticket_number ?? context.task_id} ${JSON.stringify(context.title)} on board ${context.project_id}`
    : context.scope === "board"
      ? `board ${context.project_id} ${JSON.stringify(context.title)}`
      : "all boards";
  return { context, text: `Context: ${label}\n\n${text}` };
}

export type AgentChatContext = {
  project_id?: number;
  task_id?: number;
  scope?: "ticket";
  surface_path?: string;
};

export type QueuedAgentChatMessage = {
  id: string;
  content: string;
  context?: AgentChatContext;
};
