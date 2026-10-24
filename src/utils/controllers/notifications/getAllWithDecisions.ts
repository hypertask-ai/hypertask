import type { SessionUser } from "@/lib/auth/getSessionUser";
import { getOwnerBoardAccessNotifications } from "@/lib/agents/boardAccessRequests/service";
import notificationGetAll from "@/utils/controllers/notifications/getAll";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";
import { getDecisionComments } from "@/utils/controllers/notifications/decisionTasks";
import { getInboxTabs } from "@/utils/helperFunctions/helperFunctions";
import type { INotification } from "@/models/model";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7311_DECISION_COMMENT_LINK_FLAG } from "@/lib/flags/keys";

type InboxResponse = Awaited<ReturnType<typeof notificationGetAll>>;

export default async function notificationGetAllWithDecisions(
  userId: string | string[],
  principal?: SessionUser,
): Promise<InboxResponse> {
  const response = await notificationGetAll(userId);
  const json = response.json as {
    notifications?: INotification[];
    splitsNoImportant?: Parameters<typeof getInboxTabs>[1];
    showImportantSplit?: boolean;
  };
  if (response.status !== 200 || !Array.isArray(json?.notifications)) return response;

  const parsedUserId = parseInt(userId as string);
  const decisionComments = await getDecisionComments(parsedUserId, visibleUserInboxWhere(parsedUserId));

  const decisionCommentLinkEnabled = await isFeatureEnabled(HTPR_7311_DECISION_COMMENT_LINK_FLAG, parsedUserId).catch(() => false);

  const taskNotifications = json.notifications.map((notification) => {
    const decisionCommentId = notification.taskId != null
      ? decisionComments.get(notification.taskId)?.commentId
      : undefined;
    return decisionCommentId
      ? { ...notification, isDecision: true, ...(decisionCommentLinkEnabled ? { decisionCommentId } : {}) }
      : notification;
  });
  const requests = await getOwnerBoardAccessNotifications(principal?.userId === parsedUserId ? principal : undefined);
  const notifications = [...taskNotifications, ...requests as unknown as INotification[]]
    .filter((row, index, rows) => rows.findIndex(other => String(other.id) === String(row.id)) === index)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || Number(b.id) - Number(a.id));
  return {
    status: response.status,
    json: {
      ...json,
      notifications,
      structuredData: getInboxTabs(notifications, json.splitsNoImportant, json.showImportantSplit),
    },
  } as unknown as InboxResponse;
}
