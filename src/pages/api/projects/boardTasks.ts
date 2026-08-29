import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import getBoardTasks from "@/utils/controllers/projects/getBoardTasks";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    const session = verifySession(req.cookies[SESSION_COOKIE]);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    const currentUserId = JSON.parse(req.cookies.nookies_user ?? "{}").id;
    const response = await getBoardTasks(
      req.body.projectId,
      session.id,
      currentUserId
    );
    return res.status(response.status).json(response.json);
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
