import type { INotification } from "@/models/model";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  getInboxTabs,
  type InboxStructuredDataCompact,
} from "@/utils/helperFunctions/helperFunctions";
import { notificationInboxInclude } from "@/utils/controllers/notifications/getAll";

export const agentInboxVisibilityWhere = (
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
