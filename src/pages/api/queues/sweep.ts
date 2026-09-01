import type { NextApiRequest, NextApiResponse } from "next";
import { subDays } from "date-fns";
import prisma from "@/lib/prisma";
import { withQstashSignature } from "@/lib/qstash";
import { invokeDueReminder } from "@/utils/controllers/reminders/invokeReminder";
import { createDueDateOverdueNotifications } from "@/utils/controllers/tasks/invokeDueDate";
import {
  claimAndInvokeTaskDelete,
  HARD_DELETE_PROCESSING_TIMEOUT_MINUTES,
} from "@/utils/controllers/tasks/invokeTaskDelete";
import {
  CHAT_SESSION_EXPIRY_DAYS,
  recreateSessionIfEmpty,
} from "@/utils/controllers/ai-chat/invokeChatSessionExpiry";
import type { IReminder } from "@/models/model";
import { sweepAutoArchives } from "@/utils/controllers/tasks/sweepAutoArchive";
import { sweepStaleNudges } from "@/utils/controllers/tasks/sweepStaleNudges";
import { sweepCycleRollovers } from "@/lib/cycleService";
import { getRedis } from "@/lib/redis";
import { sweepAgentWebhookDeliveries } from "@/lib/agentWebhooks/delivery";
import { sweepPendingAgentTaskCreatedWebhooks } from "@/lib/agentWebhooks/taskCreatedRecovery";
import { sweepBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outboxDelivery";

// Overlap guard: a Redis NX lease with a TTL just under the 1-min cron interval,
// so an overlapping tick no-ops instead of double-processing the findMany-then-act
// sources (task-delete, chat-expiry) the atomic claims don't already protect. A TTL
// self-heals a crashed tick, unlike a Postgres session advisory lock, which can leak
// on a pooled connection (the unlock may land on a different connection) and wedge
// the sweep permanently.
const SWEEP_LEASE_KEY = "sweep:lock";
const SWEEP_LEASE_TTL_SECONDS = 55;

// Cap work per tick so a backlog (first run after the migration, or after downtime)
// can't run past the request timeout; the next minute's tick drains the rest. Atomic
// claims make bounded, resumable batches safe.
const SWEEP_BATCH = 500;
const SWEEP_DELETE_BATCH = 100; // deletes recurse + fan out to ~14 child deletes each

interface SweepSummary {
  reminders: number;
  dueDates: number;
  deletes: number;
  chatExpiries: number;
  autoArchives: number;
  staleNudges: number;
  cycleRollovers: number;
  agentWebhooks: number;
  agentTaskCreated: number;
  boardWebhooks: number;
}

type ClaimedReminderRow = {
  id: number;
  createdAt: Date;
  status: string;
  invokeCondition: string;
  updatedAt: Date | null;
  remindAt: Date | null;
  userId: number;
  projectId: number;
  taskId: number;
};

type ClaimedDueDateRow = {
  id: number;
  userId: number;
  projectId: number;
};

type ClaimedTaskDeleteRow = {
  id: number;
};

/**
 * REMINDERS: collect a bounded batch of due reminders, then let invokeDueReminder
 * atomically claim each row with current DB-state guards before unarchiving the
 * notification. A reminder changed to a future remindAt, canceled, or attached to
 * a deleted task becomes a no-op.
 */
async function sweepReminders(): Promise<number> {
  const dueReminders = await prisma.reminder.findMany({
    where: {
      status: "Normal",
      remindAt: { lte: new Date() },
    },
    orderBy: { remindAt: "asc" },
    take: SWEEP_BATCH,
  });

  let invoked = 0;
  for (const reminder of dueReminders) {
    try {
      const result = await invokeDueReminder(reminder as unknown as IReminder);
      if (result === "invoked") invoked += 1;
    } catch (error) {
      console.log("🚀 ~ sweepReminders ~ row error:", error);
    }
  }

  return invoked;
}

/**
 * DUE DATES: atomically claim a bounded batch of overdue, un-notified tasks by
 * setting dueDateNotifiedAt in one UPDATE ... RETURNING. Calls the factored
 * createDueDateOverdueNotifications helper directly (not invokeDueDate) - both
 * atomically claim the marker before firing, so neither the delayed job nor an
 * overlapping tick can double-fire the same TaskOverdue.
 */
async function sweepDueDates(): Promise<number> {
  const claimed = await prisma.$queryRaw<ClaimedDueDateRow[]>`
    UPDATE "Task"
    SET "dueDateNotifiedAt" = now()
    WHERE id IN (
      SELECT id FROM "Task"
      WHERE "dueDateNotifiedAt" IS NULL
        AND "dueDate" <= now()
        AND status NOT IN ('Deleted', 'Archive')
      ORDER BY "dueDate"
      LIMIT ${SWEEP_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "userId", "projectId"
  `;

  for (const task of claimed) {
    try {
      await createDueDateOverdueNotifications(
        task.id,
        task.projectId,
        task.userId,
      );
    } catch (error) {
      // Rows are already claimed (dueDateNotifiedAt set); isolate a bad one so it
      // doesn't drop the rest of the batch.
      console.log("🚀 ~ sweepDueDates ~ row error:", error);
    }
  }

  return claimed.length;
}

/**
 * TASK DELETE: hard-delete a bounded batch of tasks past permanentlyDeleteAt.
 * invokeTaskDelete recurses into subtasks, so a deleted root also clears its
 * children; collecting a child again here is a harmless idempotent no-op (deleteMany
 * finds nothing). We deliberately do NOT filter to parentTaskId: null - a subtask
 * deleted on its own (parent still alive) must still be collected, otherwise it
 * lingers as a Deleted row forever.
 */
async function sweepTaskDeletes(): Promise<number> {
  const tasks = await prisma.$queryRaw<ClaimedTaskDeleteRow[]>`
    SELECT id FROM "Task"
    WHERE status = 'Deleted'
      AND "permanentlyDeleteAt" <= now()
      AND (
        "hardDeleteProcessingAt" IS NULL
        OR "hardDeleteProcessingAt" <= now() - (${HARD_DELETE_PROCESSING_TIMEOUT_MINUTES} * interval '1 minute')
      )
    ORDER BY "permanentlyDeleteAt"
    LIMIT ${SWEEP_DELETE_BATCH}
  `;

  for (const task of tasks) {
    try {
      await claimAndInvokeTaskDelete(task.id);
    } catch (error) {
      console.log("🚀 ~ sweepTaskDeletes ~ row error:", error);
    }
  }

  return tasks.length;
}

/**
 * CHAT EXPIRY: batch-delete stale sessions, then run the "recreate if empty" step
 * ONCE per affected user (not once per deleted session row).
 */
async function sweepChatExpiries(): Promise<number> {
  const expiryThreshold = subDays(new Date(), CHAT_SESSION_EXPIRY_DAYS);

  const staleSessions = await prisma.chatSession.findMany({
    where: { updatedAt: { lte: expiryThreshold } },
    select: { id: true, userId: true },
    take: SWEEP_BATCH,
  });

  if (staleSessions.length === 0) return 0;

  const deleted = await prisma.chatSession.deleteMany({
    where: {
      id: { in: staleSessions.map((s) => s.id) },
      // Re-check staleness at delete time: a session bumped between the findMany
      // above and here (user sent a message in that gap) must not be deleted along
      // with its just-created messages (ChatMessage cascades on session delete).
      updatedAt: { lte: expiryThreshold },
    },
  });

  const affectedUserIds = [...new Set(staleSessions.map((s) => s.userId))];
  for (const userId of affectedUserIds) {
    try {
      await recreateSessionIfEmpty(userId);
    } catch (error) {
      console.log("🚀 ~ sweepChatExpiries ~ recreate error:", error);
    }
  }

  return deleted.count;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Take the overlap lease. If Redis is down, proceed lockless rather than skip
  // the whole tick: the atomic claims still prevent double-fire, worst case is
  // redundant work on a rare overlap.
  let haveLease = true;
  let redis: Awaited<ReturnType<typeof getRedis>> | undefined;
  try {
    redis = await getRedis();
    haveLease =
      (await redis.set(
        SWEEP_LEASE_KEY,
        "1",
        "EX",
        SWEEP_LEASE_TTL_SECONDS,
        "NX",
      )) === "OK";
  } catch (error) {
    console.log(
      "🚀 ~ sweep ~ redis lease unavailable, proceeding lockless:",
      error,
    );
  }

  if (!haveLease) {
    // Another tick still holds the lease - no-op instead of double-processing.
    return res.status(200).json({ skipped: "locked" });
  }

  const summary: SweepSummary = {
    reminders: 0,
    dueDates: 0,
    deletes: 0,
    chatExpiries: 0,
    autoArchives: 0,
    staleNudges: 0,
    cycleRollovers: 0,
    agentWebhooks: 0,
    agentTaskCreated: 0,
    boardWebhooks: 0,
  };

  try {
    // Each source is independent: one failing must not block the others.
    try {
      summary.reminders = await sweepReminders();
    } catch (error) {
      console.log("🚀 ~ sweep ~ reminders error:", error);
    }

    try {
      summary.dueDates = await sweepDueDates();
    } catch (error) {
      console.log("🚀 ~ sweep ~ dueDates error:", error);
    }

    try {
      summary.deletes = await sweepTaskDeletes();
    } catch (error) {
      console.log("🚀 ~ sweep ~ deletes error:", error);
    }

    try {
      summary.chatExpiries = await sweepChatExpiries();
    } catch (error) {
      console.log("🚀 ~ sweep ~ chatExpiries error:", error);
    }

    try {
      summary.autoArchives = await sweepAutoArchives();
    } catch (error) {
      console.log("🚀 ~ sweep ~ autoArchives error:", error);
    }

    try {
      summary.staleNudges = await sweepStaleNudges();
    } catch (error) {
      console.log("🚀 ~ sweep ~ staleNudges error:", error);
    }

    try {
      summary.cycleRollovers = await sweepCycleRollovers();
    } catch (error) {
      console.log("🚀 ~ sweep ~ cycleRollovers error:", error);
    }

    try {
      summary.agentWebhooks = await sweepAgentWebhookDeliveries();
    } catch (error) {
      console.log("🚀 ~ sweep ~ agentWebhooks error:", error);
    }

    try {
      summary.agentTaskCreated = await sweepPendingAgentTaskCreatedWebhooks();
    } catch (error) {
      console.log("🚀 ~ sweep ~ agentTaskCreated error:", error);
    }

    try {
      summary.boardWebhooks = await sweepBoardWebhookDeliveries();
    } catch (error) {
      console.log("🚀 ~ sweep ~ boardWebhooks error:", error);
    }

    return res.status(200).json(summary);
  } finally {
    try {
      await redis?.del(SWEEP_LEASE_KEY);
    } catch {
      // lease TTL will expire it anyway
    }
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
