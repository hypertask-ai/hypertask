import { tool } from "ai";
import { z } from "zod";
import { listRunning, elapsedSeconds } from "@/lib/timeTracking";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createRunningTimersTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_running_timers: tool({
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
    }),
  };
}
