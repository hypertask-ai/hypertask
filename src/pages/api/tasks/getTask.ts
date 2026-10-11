import type { NextApiRequest, NextApiResponse } from "next";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

const handler = taskWriteHandler({
  GET: async () => (await import("@/lib/api/task-writes/task-read")).GET,
}, {
  methodNotAllowed: { message: "Method not allowed." },
});

export default function handlerWithHeaders(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");
  return handler(req, res);
}
