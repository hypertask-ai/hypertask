import type { NextApiRequest, NextApiResponse } from "next";
import { reportLegacyRouteHit } from "@/lib/telemetry/legacyRouteHit";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const handler = taskWriteHandler({
  GET: async () => (await import("@/lib/api/notification-writes/mute")).GET,
  POST: async () => (await import("@/lib/api/notification-writes/mute")).POST,
});

export default function legacyRoute(req: NextApiRequest, res: NextApiResponse) {
  reportLegacyRouteHit("/api/notifications/mute", req);
  return handler(req, res);
}
