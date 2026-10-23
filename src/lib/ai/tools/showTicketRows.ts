import { tool } from "ai";
import { ticketGroupsSchema } from "@/lib/ai/chatStream/ticketGroups";
import type { ToolContext } from "./context";

const retrievalTools = new Set([
  "hypertask_search_tasks", "hypertask_list_tasks", "hypertask_get_tasks", "hypertask_my_tasks", "hypertask_next_tasks",
]);

type RetrievedTask = { task_id?: number; id?: number };
type RetrievalResult = { success?: boolean; tasks?: RetrievedTask[]; boards?: { tasks?: RetrievedTask[] }[] } | null;

function retrievedTasks(result: RetrievalResult): RetrievedTask[] {
  if (result?.success !== true) return [];
  const boards = Array.isArray(result.boards) ? result.boards : [];
  return [
    ...(Array.isArray(result.tasks) ? result.tasks : []),
    ...boards.flatMap((board) => Array.isArray(board?.tasks) ? board.tasks : []),
  ];
}

export const TICKET_ROWS_PROMPT = "For ticket questions, answer with one short sentence, then call hypertask_show_ticket_rows instead of writing an HTML list or table of tickets. Retrieve tickets first with search, list, get, my tasks (include_tasks true) or next tasks in this turn, and copy their task_id values exactly. Use short group labels such as Done or New only when useful. The rows already include ticket links, status, assignees and priority.";

export function createShowTicketRowsTool(context: ToolContext) {
  const { executions, setGroups } = context.ticketRows;
  return { hypertask_show_ticket_rows: tool({
    description: "Display up to 50 retrieved tickets in up to four compact groups. Call after successful search/list/get/my tasks/next tasks in this turn; use task_id, never a ticket number or uniqueIndex. Replaces any previous display selection this turn.",
    inputSchema: ticketGroupsSchema,
    execute: async (input) => {
      const parsed = ticketGroupsSchema.safeParse(input);
      if (!parsed.success) return { success: false, error: "Use 1–4 groups and at most 50 ticket IDs total." };
      const allowed = new Set<number>();
      for (const execution of executions) {
        if (!retrievalTools.has(execution.name)) continue;
        for (const task of retrievedTasks(execution.result as RetrievalResult)) {
          const id = task.task_id ?? task.id;
          if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) allowed.add(id);
        }
      }
      if (parsed.data.groups.some((group) => group.taskIds.some((id) => !allowed.has(id)))) {
        return { success: false, error: "Only task IDs returned by successful search/list/get/my tasks/next tasks tools in this turn may be displayed. Retrieve the tickets first." };
      }
      const seen = new Set<number>();
      const groups = parsed.data.groups.map((group) => ({
        ...group,
        taskIds: group.taskIds.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      })).filter((group) => group.taskIds.length > 0);
      setGroups({ version: 1, groups });
      return { success: true, displayed: seen.size };
    },
  }) };
}
