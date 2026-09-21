import { markTaskRead } from "@/utils/controllers/tasks/markRead";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

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
    try {
      const user = req.cookies?.nookies_user
        ? JSON.parse(req.cookies.nookies_user)
        : null;
      const { taskId } = parseBody(req.body);
      const parsedTaskId = parseInt(String(taskId), 10);

      if (!user?.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!Number.isFinite(parsedTaskId)) {
        return res.status(400).json({ message: "Task id is required" });
      }

      const response = await markTaskRead(parsedTaskId, user.id);
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
