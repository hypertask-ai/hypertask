import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import getBoardTasks from "@/utils/controllers/projects/getBoardTasks";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    const response = await getBoardTasks(
      req.body.projectId,
      session.userId,
      session.userId
    );
    return res.status(response.status).json(response.json);
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
