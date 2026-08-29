import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";
import { generalConfig } from "@/lib/configs/general.config";
import {
  createTaskNotifications,
  getUserIdsForNotification,
} from "./invokeDueDate";

export const STALE_NUDGE_BATCH = 50;

type ClaimedStaleTask = {
  id: number;
  projectId: number;
  userId: number;
};

/** Claims and notifies one bounded batch, once per task activity episode. */
export async function sweepStaleNudges(): Promise<number> {
  const claimed = await prisma.$queryRaw<ClaimedStaleTask[]>`
    WITH candidates AS (
      SELECT
        t.id,
        t."projectId",
        t."userId"
      FROM "Task" t
      JOIN "Project" p ON p.id = t."projectId"
      WHERE t.status = 'Normal'
        AND t."parentTaskId" IS NULL
        AND p.status = 'Normal'
        AND p."stalenessEnabled" = true
        AND p."staleNudgeEnabled" = true
        AND GREATEST(
              COALESCE(t."sectionChangedAt", t."createdAt"),
              COALESCE(t."lastCommentAt", t."createdAt")
            ) <= now() - COALESCE(p."staleWarnDays", 7) * interval '1 day'
        AND (
          t."staleNudgedAt" IS NULL
          OR t."staleNudgedAt" < GREATEST(
            COALESCE(t."sectionChangedAt", t."createdAt"),
            COALESCE(t."lastCommentAt", t."createdAt")
          )
        )
      ORDER BY GREATEST(
        COALESCE(t."sectionChangedAt", t."createdAt"),
        COALESCE(t."lastCommentAt", t."createdAt")
      ) ASC
      LIMIT ${STALE_NUDGE_BATCH}
      FOR UPDATE OF t SKIP LOCKED
    )
    UPDATE "Task" t
    SET "staleNudgedAt" = now()
    FROM candidates c
    WHERE t.id = c.id
    RETURNING
      t.id,
      t."projectId",
      t."userId"
  `;

  // Claim commits before fan-out, like sweepDueDates; failed delivery consumes the episode.
  for (const task of claimed) {
    try {
      const userIds = await getUserIdsForNotification(
        task.id,
        task.userId,
        true,
      );
      await createTaskNotifications({
        fromUserId: generalConfig.hyperAiId,
        projectId: task.projectId,
        taskId: task.id,
        type: "TaskReminder",
        userIds,
      });
      for (const userId of userIds) {
        void broadcastInboxChange(userId, {
          originUserId: generalConfig.hyperAiId,
        });
      }
    } catch (error) {
      console.log("🚀 ~ sweepStaleNudges ~ row error:", error);
    }
  }

  return claimed.length;
}
