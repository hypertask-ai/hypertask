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
import { sweepValentinWaitingOn } from "@/utils/controllers/tasks/sweepValentinWaitingOn";
import { sweepCycleRollovers } from "@/lib/cycleService";
import { getRedis } from "@/lib/redis";
import { HTPR_7042_NEON_WORK_AVOIDANCE_FLAG, isFeatureEnabled, withFeatureFlagSnapshot } from "@/lib/flags";
import { sweepAgentWebhookDeliveries } from "@/lib/agentWebhooks/delivery";
import { sweepPendingAgentTaskCreatedWebhooks } from "@/lib/agentWebhooks/taskCreatedRecovery";
import { sweepBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outboxDelivery";
import { sweepExpiredAgentChatTurns } from "@/lib/agentRuns/service";
import { sweepGoogleCalendarConnections } from "@/lib/googleCalendar/sync";

const SWEEP_LEASE_KEY = "sweep:lock";
const SWEEP_LEASE_TTL_SECONDS = 55;

const SWEEP_BATCH = 500;
const SWEEP_DELETE_BATCH = 100;

interface SweepSummary {
  reminders: number;
  dueDates: number;
  deletes: number;
  chatExpiries: number;
  autoArchives: number;
  staleNudges: number;
  waitingOn: number;
  cycleRollovers: number;
  agentWebhooks: number;
  agentTaskCreated: number;
  boardWebhooks: number;
  googleCalendars: number;
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
      console.log("🚀 ~ sweepDueDates ~ row error:", error);
    }
  }

  return claimed.length;
}

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
  let haveLease = true;
  let redis: Awaited<ReturnType<typeof getRedis>> | undefined;
  const leaseStartedAt = Date.now();
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
    return res.status(200).json({ skipped: "locked" });
  }

  const summary: SweepSummary = {
    reminders: 0,
    dueDates: 0,
    deletes: 0,
    chatExpiries: 0,
    autoArchives: 0,
    staleNudges: 0,
    waitingOn: 0,
    cycleRollovers: 0,
    agentWebhooks: 0,
    agentTaskCreated: 0,
    boardWebhooks: 0,
    googleCalendars: 0,
  };

  try {
    const avoidRepeatedWork = await isFeatureEnabled(HTPR_7042_NEON_WORK_AVOIDANCE_FLAG, 0).catch(() => false);
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
      summary.waitingOn = await sweepValentinWaitingOn();
    } catch (error) {
      console.log("[sweep] waiting-on sync failed:", error);
    }

    try {
      summary.cycleRollovers = avoidRepeatedWork
        ? await sweepCycleRollovers(new Date(), undefined, true)
        : await sweepCycleRollovers();
    } catch (error) {
      console.log("🚀 ~ sweep ~ cycleRollovers error:", error);
    }

    try {
      summary.agentWebhooks = await sweepAgentWebhookDeliveries();
    } catch (error) {
      console.log("🚀 ~ sweep ~ agentWebhooks error:", error);
    }

    try {
      await sweepExpiredAgentChatTurns();
    } catch (error) {
      console.log("🚀 ~ sweep ~ agentChatTurns error:", error);
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

    try {
      summary.googleCalendars = await sweepGoogleCalendarConnections({
        deadlineAt:
          leaseStartedAt + (SWEEP_LEASE_TTL_SECONDS - 10) * 1000,
      });
    } catch (error) {
      console.log("🚀 ~ sweep ~ googleCalendars error:", error);
    }

    return res.status(200).json(summary);
  } finally {
    try {
      await redis?.del(SWEEP_LEASE_KEY);
    } catch {
    }
  }
}

export default withQstashSignature((req, res) =>
  withFeatureFlagSnapshot(() => handler(req, res)),
);

export const config = {
  api: {
    bodyParser: false,
  },
};
