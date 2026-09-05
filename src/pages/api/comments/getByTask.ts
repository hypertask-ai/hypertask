import { getSessionUser } from "@/lib/auth/getSessionUser";
import commentsGetByTask from "@/utils/controllers/comments/getByTask";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const taskId = Number(req.query.taskId);
    if (!Number.isInteger(taskId) || taskId < 1) {
      return res.status(400).json({ message: "Task id is required" });
    }
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const response = await commentsGetByTask(session.userId, String(taskId));
    return res.status(response.status).json(response.json);
  } catch (error) {
    console.error("GET /api/comments/getByTask failed", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
