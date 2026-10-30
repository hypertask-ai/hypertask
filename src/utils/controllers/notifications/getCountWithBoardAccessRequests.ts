import type { SessionUser } from "@/lib/auth/getSessionUser";
import { getOwnerBoardAccessNotifications } from "@/lib/agents/boardAccessRequests/service";
import notificationGetCount from "./getCount";

export default async function getCountWithBoardAccessRequests(userId: number, principal?: SessionUser) {
  const response = await notificationGetCount(userId);
  if (response.status !== 200 || typeof response.json.all !== "number") return response;
  const requests = await getOwnerBoardAccessNotifications(principal?.userId === userId ? principal : undefined);
  return { ...response, json: { all: response.json.all + requests.length, unseen: response.json.unseen || (requests.some(row => !row.seen) ? 1 : 0) } };
}
