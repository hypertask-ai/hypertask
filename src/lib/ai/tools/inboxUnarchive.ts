import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createInboxUnarchiveTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_inbox_unarchive: tool({
      description:
        "Unarchive one or more of the authenticated user's archived inbox notifications. Discover archived notification ids with hypertask_inbox_list using archived=true.",
      inputSchema: z.object({
        notification_ids: z.array(z.coerce.number().int().positive()).min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_inbox_unarchive");
        const result = await prisma.notification.updateMany({
          where: {
            id: { in: input.notification_ids },
            userId: user.id,
            status: "Archive",
          },
          data: {
            status: "Normal",
            archivedAt: null,
          },
        });

        void broadcastInboxChange(user.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          unarchived_count: result.count,
        });
      }),
    }),
  };
}
