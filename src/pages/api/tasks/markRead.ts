import { markTaskRead } from "@/utils/controllers/tasks/markRead";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const parseBody = (body: unknown) => {
  if (typeof body !== "string") return body as { taskId?: unknown };

  try {
    return JSON.parse(body) as { taskId?: unknown };
  } catch {
    return {};
  }
};

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    try {
      const { taskId } = parseBody(req.body);
      const parsedTaskId = parseInt(String(taskId), 10);

      if (!Number.isFinite(parsedTaskId)) {
        return res.status(400).json({ message: "Task id is required" });
      }

      const response = await markTaskRead(parsedTaskId, userId);
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
