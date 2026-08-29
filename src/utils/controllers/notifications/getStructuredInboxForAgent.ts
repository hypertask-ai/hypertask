import type { INotification } from "@/models/model";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  getInboxTabs,
  type InboxStructuredDataCompact,
} from "@/utils/helperFunctions/helperFunctions";
import { notificationInboxInclude } from "@/utils/controllers/notifications/getAll";

/**
 * A notification is live in the agent inbox when it is not archived or deleted and its
 * task (if it has one) still exists. Taskless rows stay visible, hence the OR: a
 * top-level `task` filter would silently drop them, because a relation filter cannot be
 * satisfied by a null relation.
 *
 * Deliberately NOT the user inbox's filter. That one also hides tasks behind an active
 * reminder, but reminders are per-user and agents do not snooze, so reusing it would let
 * any user's reminder hide every agent notification for that task.
 *
 * `userId` is redundant as a filter — every row reachable through `notificationsToAgent`
 * already belongs to this agent, and an agent notification is always created with its
 * owner's id (createAgentMentionNotification passes `userId: agent.userId`). It is here
 * purely so Postgres can use the existing `(userId, status, agentId, createdAt)` index:
 * without a leading `userId` no Notification index matches this query, and candidate
 * selection scans a large slice of the table (HTPR-4095).
 */
const agentInboxVisibilityWhere = (
  userId: number,
  window?: { after: Date | null; through: Date },
) =>
  ({
    userId,
    status: "Normal",
    ...(window
      ? {
          createdAt: {
            ...(window.after ? { gt: window.after } : {}),
            lte: window.through,
          },
        }
      : {}),
    OR: [{ task: { status: "Normal" } }, { taskId: null }],
  }) satisfies Prisma.NotificationWhereInput;

export type GetStructuredInboxForAgentResult =
  | {
      ok: true;
      structuredData: InboxStructuredDataCompact;
      notifications: INotification[];
    }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "internal" };

export async function getStructuredInboxForAgent(params: {
  userId: number;
  agentId: string;
  window?: { after: Date | null; through: Date };
}): Promise<GetStructuredInboxForAgentResult> {
  const { userId, agentId, window } = params;

  try {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, userId, revokedAt: null },
      include: {
        notificationsToAgent: {
          // Without this the agent inbox returned archived notifications, and an archived
          // row could shadow a live one because distinct runs after the filter (HTPR-4090).
          where: agentInboxVisibilityWhere(userId, window),
          include: notificationInboxInclude(userId),
          orderBy: {
            createdAt: "desc",
          },
          distinct: ["taskId", "notification_inviteId"],
        },
      },
    });

    if (!agent) {
      return { ok: false, kind: "not_found" };
    }

    const notifications = agent.notificationsToAgent;
    // Prisma row shape matches runtime inbox usage; INotification id type differs from DB
    const structuredData = getInboxTabs(notifications as any);

    return {
      ok: true,
      structuredData,
      notifications: notifications as any as INotification[],
    };
  } catch {
    return { ok: false, kind: "internal" };
  }
}
