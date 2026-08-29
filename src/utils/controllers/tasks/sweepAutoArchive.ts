import prisma from "@/lib/prisma";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { cancelDueDateJob } from "@/pages/api/queues/duedateQueue";
import {
  broadcastBoardChange,
  broadcastTaskChange,
} from "@/lib/realtime/server";
import { generalConfig } from "@/lib/configs/general.config";
import type { IUser } from "@/models/model";

// Bounded like the other sweep sources; the next tick drains the rest. Small on
// purpose: every archive fans out to activity + follower notifications.
export const AUTO_ARCHIVE_BATCH = 50;

type CandidateRow = {
  id: number;
  projectId: number;
};

/**
 * AUTO-ARCHIVE: on boards that opted in (Project.autoArchiveAfterDays set),
 * archive root tasks nobody has touched — no edit, no comment — for that many
 * days. Linear-parity guards: a future due date keeps a task alive, and
 * subtasks are never collected on their own (they follow their parent).
 * Archive is Status.Archive, fully reversible from the archived view.
 *
 * The cutoff is per project, so candidates are selected in SQL with a join;
 * overlap is prevented by the sweep's Redis lease (same as sweepReminders).
 */
export async function sweepAutoArchives(): Promise<number> {
  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    SELECT t.id, t."projectId"
    FROM "Task" t
    JOIN "Project" p ON p.id = t."projectId"
    WHERE t.status = 'Normal'
      AND t."parentTaskId" IS NULL
      AND p."autoArchiveAfterDays" IS NOT NULL
      AND p."autoArchiveAfterDays" > 0
      AND (t."dueDate" IS NULL OR t."dueDate" <= now())
      AND GREATEST(
            t."createdAt",
            COALESCE(t."updatedAt", t."createdAt"),
            COALESCE(t."lastCommentAt", t."createdAt")
          ) <= now() - p."autoArchiveAfterDays" * interval '1 day'
    ORDER BY t."updatedAt" ASC NULLS FIRST
    LIMIT ${AUTO_ARCHIVE_BATCH}
  `;

  if (candidates.length === 0) return 0;

  // System actor: archives are attributed to HyperAI in activity and
  // notifications, never to a human who did not act.
  const hyperAi = await prisma.user.findUnique({
    where: { id: generalConfig.hyperAiId },
  });
  const actor = (hyperAi ?? {
    id: generalConfig.hyperAiId,
    displayName: "HyperAI",
  }) as IUser;

  let archived = 0;
  const touchedProjects = new Set<number>();
  const now = new Date();

  for (const task of candidates) {
    try {
      // Same building blocks as /api/tasks/(un)archive, so the archive carries
      // the normal activity entry and follower/assignee notifications.
      const { status } = await updateTaskSingle(
        {
          id: task.id,
          status: "Archive",
          archivedAt: now,
          updatedAt: now,
          dueDate: null,
        },
        actor,
        null,
        // trustedCaller: a cron, not a request. The actor is a stand-in for
        // activity attribution and is not necessarily on the board.
        // Auto-archive fires because nobody touched the task, which is
        // abandonment rather than completion. Spawning the next occurrence
        // here would put a neglected recurring task on a treadmill: the copy
        // goes stale, gets archived, spawns again, forever. A person
        // completing it still repeats it (HTPR-4885).
        { skipRecurrence: true, trustedCaller: true }
      );
      if (status !== 200) continue;

      await cancelDueDateJob(task.id, task.projectId);
      await createArchiveActivity({
        taskId: task.id,
        fromUserId: actor.id,
        fromUserDisplayName: actor.displayName ?? "HyperAI",
        fromUser: actor,
        newStatus: "Archive",
      });
      sendNotificationForTask(actor.id, "TaskArchived", task.id, task.projectId, null);
      void broadcastTaskChange(task.id, { originUserId: actor.id });
      touchedProjects.add(task.projectId);
      archived += 1;
    } catch (error) {
      // Isolate a bad row so it does not drop the rest of the batch.
      console.log("🚀 ~ sweepAutoArchives ~ row error:", error);
    }
  }

  for (const projectId of touchedProjects) {
    void broadcastBoardChange(projectId, { originUserId: actor.id });
  }

  return archived;
}
