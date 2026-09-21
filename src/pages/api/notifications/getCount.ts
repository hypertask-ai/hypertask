import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import notificationGetCount from "@/utils/controllers/notifications/getCount";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method === "GET") {
    try {
      const session = await getAuthSession(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });

      const response = await notificationGetCount(session.userId);
      res.status(response.status).json(response.json);
    } catch (error) {
      htLogger.info({ error });
      res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default withAuth(handler, { authenticateInHandler: true });
