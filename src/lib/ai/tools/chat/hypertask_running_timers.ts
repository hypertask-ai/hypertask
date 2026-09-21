import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskRunningTimersTool(context: ChatToolContext) {
  const { elapsedSeconds, listRunning, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description: "List the authenticated user's running timers.",
      inputSchema: z.object({}),
      execute: withToolErrors(async () => {
        sendStatus("hypertask_running_timers");
        const now = new Date();
        const entries = await listRunning(user.id);
        const timers = entries.map((entry) => ({
          id: entry.id,
          task: {
            title: entry.task.title,
            ticketId: entry.task.ticketNumber ?? String(entry.task.uniqueIndex),
          },
          pausedAt: entry.pausedAt,
          elapsedSeconds: elapsedSeconds(entry.startedAt, null, entry.pausedAt, now),
        }));

        return sanitizeForJson({ success: true, timers });
      }),
    });
}
