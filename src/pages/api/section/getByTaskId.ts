import type { NextApiRequest, NextApiResponse } from "next";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const handler = taskWriteHandler({
  POST: async () => (await import("@/lib/api/section-writes/get-by-task")).POST,
});

// No app caller is known (HTPR-6992); this log shows any remaining outside use.
export default function legacyRoute(req: NextApiRequest, res: NextApiResponse) {
  console.warn("legacy route hit: /api/section/getByTaskId");
  return handler(req, res);
}
