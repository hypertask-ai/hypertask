import notificationGetAll from "@/utils/controllers/notifications/getAll";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";
import { getDecisionTaskIds } from "@/utils/controllers/notifications/decisionTasks";
import { getInboxTabs } from "@/utils/helperFunctions/helperFunctions";
import type { INotification } from "@/models/model";

type InboxResponse = Awaited<ReturnType<typeof notificationGetAll>>;

/**
 * HTPR-7092: the inbox read with the Decisions split. Wraps the existing read so its
 * bytes stay untouched. Flag-gated on the server: with the flag off (or no pending
 * Question) the response is returned as is, so no Decisions split exists.
 */
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
  const decisionTaskIds = await getDecisionTaskIds(parsedUserId, visibleUserInboxWhere(parsedUserId));
  if (!decisionTaskIds.size) return response;

  const notifications = json.notifications.map((notification) =>
    notification.taskId != null && decisionTaskIds.has(notification.taskId)
      ? { ...notification, isDecision: true }
      : notification,
  );
  return {
    status: response.status,
    json: {
      ...json,
      notifications,
      structuredData: getInboxTabs(notifications, json.splitsNoImportant, json.showImportantSplit),
    },
  } as InboxResponse;
}
