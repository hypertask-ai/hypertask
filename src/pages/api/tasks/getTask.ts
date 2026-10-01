import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetTask from "@/utils/controllers/tasks/getTask";
import { httpStatusConfig } from "@/lib/configs/http-status.config";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import type { IUser } from "@/models/model";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  // Same private headers as /api/comments/getByTask. Without them Vercel
  // defaults this cookie-authenticated payload to `public`, so a realtime
  // refetch can reuse a pre-change response while comments (private,
  // no-store) still update — QA fail #2 on HTPR-6281.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie");

  if (req.method === "GET") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userObj = { id: session.userId } as IUser;
    try {
      const { project, uniqueIndex } = req.query;
      if (!uniqueIndex || !project) {
        return res
          .status(400)
          .json({ message: httpStatusConfig.statusCodes[400].userMessage });
      }
      const response = await tasksGetTask(
        project as string,
        uniqueIndex as string,
        userObj
      );

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log({ error });
      return res
        .status(500)
        .json({ message: httpStatusConfig.statusCodes[500].userMessage });
    }
  } else {
    res
      .status(405)
      .json({ message: httpStatusConfig.statusCodes[405].userMessage });
  }
};

export default handler;
