import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import { type ToolSet } from "ai";
import { withAdoptedAgentMutationLease } from "@/lib/mcp/tasks/agentMutationLeaseAdoption";
import prisma from "@/lib/prisma";
import { findTaskByIdentifier, validateTaskIdentifier, TaskIdentifierAmbiguityError } from "@/lib/mcp/tasks/resolveTask";
import { type ToolTaskIdentifierInput, decideTaskIdentifierMatch } from "@/app/api/ai/chat/stream/bulkTools";
import { ToolExecutionRecorder, ToolStartRecorder, AuthedUser } from "@/lib/ai/chatStream/types";
import { errorMessage } from "@/lib/ai/chatStream/errors";
import { refuseReadAgentToolCall } from "@/lib/ai/tools/readAgentGate";

export function trackToolSetExecutions(
  tools: ToolSet,
  recordToolExecution: ToolExecutionRecorder,
  recordToolStart?: ToolStartRecorder,
  leaseActor: { agentId: string; userId: number } | null = null
) {
  for (const [name, rawTool] of Object.entries(tools)) {
    const trackedTool = rawTool as {
      execute?: (...args: unknown[]) => unknown;
    };
    if (typeof trackedTool.execute !== "function") continue;

    const execute = trackedTool.execute;
    trackedTool.execute = (...args: unknown[]) => withAgentScopeRequest({ url: "/api/ai/chat/stream", method: "POST" }, async () => {
      if (leaseActor) await prepareAgentScope(leaseActor.userId, leaseActor.agentId);
      const refusal = leaseActor ? await refuseReadAgentToolCall(leaseActor, name, args[0]) : null;
      if (refusal) {
        recordToolExecution({ name, result: refusal });
        return refusal;
      }
      const release = await recordToolStart?.(name);
      try {
        const result = await withAdoptedAgentMutationLease(
          prisma,
          leaseActor ?? {},
          async () => execute(...args)
        );
        recordToolExecution({ name, result });
        return result;
      } catch (error) {
        recordToolExecution({
          name,
          result: { success: false, error: errorMessage(error) },
        });
        throw error;
      } finally {
        if (typeof release === "function") {
          try {
            await release();
          } catch (error) {
            console.error("[ai/chat/stream] tool fence cleanup failed", error);
          }
        }
      }
    });
  }
  return tools;
}

export function dropEmptyPadding<T extends Record<string, unknown>>(
  input: T,
  fields: (keyof T)[]
): T {
  const cleaned = { ...input };
  for (const field of fields) {
    const value = cleaned[field];
    const empty =
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (empty) delete cleaned[field];
  }
  return cleaned;
}

export function withToolErrors<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }) as T;
}

export type ResolvedToolTask = NonNullable<Awaited<ReturnType<typeof findTaskByIdentifier>>>;

export type ResolveTaskForToolResult =
  | { task: ResolvedToolTask; error?: never }
  | { task: null; error?: string };

export async function resolveTaskForTool(
  user: AuthedUser,
  input: ToolTaskIdentifierInput
): Promise<ResolveTaskForToolResult> {
  const ticketNumber = input.ticket_number?.trim();
  const hasTaskId = input.task_id != null;
  const hasTicketNumber = Boolean(ticketNumber);
  const hasUniqueIndex = input.unique_index != null;
  const hasProjectId = input.project_id != null;
  const triedIdentifiers: string[] = [];

  if (!hasTaskId && !hasTicketNumber && !hasUniqueIndex) {
    const validation = validateTaskIdentifier({
      task_id: input.task_id,
      ticket_number: ticketNumber,
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    return { task: null, error: validation.error };
  }

  if (hasTaskId || ticketNumber) {
    if (hasTaskId) triedIdentifiers.push(`task_id=${input.task_id}`);
    if (ticketNumber) {
      triedIdentifiers.push(
        hasProjectId
          ? `ticket_number=${ticketNumber}, project_id=${input.project_id}`
          : `ticket_number=${ticketNumber}`
      );
    }

    try {
      const ticketMatch = ticketNumber
        ? await findTaskByIdentifier(user, {
          ticket_number: ticketNumber,
          ...(hasProjectId ? { project_id: input.project_id } : {}),
        })
        : null;
      const taskMatch = hasTaskId
        ? await findTaskByIdentifier(user, {
          task_id: input.task_id,
          ...(hasProjectId ? { project_id: input.project_id } : {}),
        })
        : null;
      const unscopedTaskMatch =
        hasTaskId && hasProjectId && !taskMatch
          ? await findTaskByIdentifier(user, { task_id: input.task_id })
          : null;
      const decision = decideTaskIdentifierMatch({
        taskId: hasTaskId ? input.task_id : undefined,
        ticketNumber,
        projectId: hasProjectId ? input.project_id : undefined,
        taskMatch,
        ticketMatch,
        unscopedTaskMatch,
      });
      if (decision.error) return { task: null, error: decision.error };
      if (decision.match) return { task: decision.match };
    } catch (error) {
      if (error instanceof TaskIdentifierAmbiguityError) {
        return { task: null, error: error.message };
      }
      throw error;
    }
  }

  if (hasUniqueIndex && hasProjectId) {
    triedIdentifiers.push(
      `unique_index=${input.unique_index}, project_id=${input.project_id}`
    );
    const task = await findTaskByIdentifier(user, {
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    if (task) return { task };
  }

  if (hasUniqueIndex && !hasProjectId && !hasTaskId && !hasTicketNumber) {
    const validation = validateTaskIdentifier({
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    if (!validation.valid) return { task: null, error: validation.error };
  }

  return {
    task: null,
    error: `Task not found or access denied. Tried identifiers: ${triedIdentifiers.join("; ")}. None of these matched a task you can access. Call hypertask_search_tasks for the task title, then copy the \`task_id\` field from the result verbatim -- do not derive identifiers from task titles.`,
  };
}
