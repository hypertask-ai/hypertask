import type { NextApiRequest, NextApiResponse } from "next";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const handler = taskWriteHandler({
  GET: async () => (await import("@/lib/api/notification-writes/mute")).GET,
  POST: async () => (await import("@/lib/api/notification-writes/mute")).POST,
});

// No app caller is known (HTPR-6992); this log shows any remaining outside use.
export default function legacyRoute(req: NextApiRequest, res: NextApiResponse) {
  console.warn("legacy route hit: /api/notifications/mute");
  return handler(req, res);
}
