import type { NextApiRequest, NextApiResponse } from "next";
import { reportLegacyRouteHit } from "@/lib/telemetry/legacyRouteHit";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const handler = taskWriteHandler({
  POST: async () => (await import("@/lib/api/section-writes/get-by-task")).POST,
});

export default function legacyRoute(req: NextApiRequest, res: NextApiResponse) {
  reportLegacyRouteHit("/api/section/getByTaskId", req);
  return handler(req, res);
}
