import type { NextApiRequest, NextApiResponse } from "next";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const handler = taskWriteHandler({
  POST: async () => (await import("@/lib/api/task-writes/link-pull-request")).POST,
});

export default function legacyRoute(req: NextApiRequest, res: NextApiResponse) {
  console.warn("legacy route hit: /api/tasks/linkPullRequest");
  return handler(req, res);
}
