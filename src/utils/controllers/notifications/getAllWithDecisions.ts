import notificationGetAll from "@/utils/controllers/notifications/getAll";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";
import { getDecisionComments } from "@/utils/controllers/notifications/decisionTasks";
import { getInboxTabs } from "@/utils/helperFunctions/helperFunctions";
import type { INotification } from "@/models/model";

type InboxResponse = Awaited<ReturnType<typeof notificationGetAll>>;

export default async function notificationGetAllWithDecisions(
  userId: string | string[],
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
  if (!decisionComments.size) return response;

  const notifications = json.notifications.map((notification) => {
    const decisionCommentId = notification.taskId != null
      ? decisionComments.get(notification.taskId)?.commentId
      : undefined;
    return decisionCommentId
      ? { ...notification, isDecision: true, decisionCommentId }
      : notification;
  });
  return {
    status: response.status,
    json: {
      ...json,
      notifications,
      structuredData: getInboxTabs(notifications, json.splitsNoImportant, json.showImportantSplit),
    },
  } as unknown as InboxResponse;
}
