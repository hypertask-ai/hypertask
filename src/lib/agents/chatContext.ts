import type { Prisma } from "@prisma/client";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

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

type ContextReader = Pick<Prisma.TransactionClient, "project" | "task">;

export async function readableAgentChatContextIds(
  db: ContextReader,
  recipient: { userId: number; agentId: string | null; teamScope?: AgentTokenTeamScope | null },
  messages: Array<{ id: string; context?: Prisma.JsonValue | null }>,
): Promise<Set<string>> {
  const readable = new Set<string>();
  const targets = new Map<string, { projectId: number; taskId: number | null }>();
  for (const message of messages) {
    const context = message.context;
    if (!context || typeof context !== "object" || Array.isArray(context)) {
      readable.add(message.id);
      continue;
    }
    const stored = context as Prisma.JsonObject;
    if (typeof stored.project_id !== "number") {
      readable.add(message.id);
      continue;
    }
    targets.set(message.id, {
      projectId: stored.project_id,
      taskId: typeof stored.task_id === "number" ? stored.task_id : null,
    });
  }
  if (targets.size === 0) return readable;
  const access = projectContentAccessWhere(recipient.userId, recipient.agentId, recipient.teamScope);
  const projectIds = [...new Set([...targets.values()].map((target) => target.projectId))];
  const readableProjects = new Set(
    (await db.project.findMany({ where: { id: { in: projectIds }, ...access }, select: { id: true } })).map((project) => project.id),
  );
  const taskIds = [...new Set([...targets.values()].flatMap((target) => target.taskId === null ? [] : [target.taskId]))];
  const readableTasks = new Set(
    taskIds.length === 0
      ? []
      : (await db.task.findMany({ where: { id: { in: taskIds }, project: access }, select: { id: true, projectId: true } })).map((task) => `${task.projectId}:${task.id}`),
  );
  for (const [id, target] of targets) {
    if (readableProjects.has(target.projectId) && (target.taskId === null || readableTasks.has(`${target.projectId}:${target.taskId}`))) {
      readable.add(id);
    }
  }
  return readable;
}
