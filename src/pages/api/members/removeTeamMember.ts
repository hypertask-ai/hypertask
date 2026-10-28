import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import { leaveTeam } from "@/utils/controllers/teams/leave";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  logDesktopCliResponse(session, req, res);
    if (!session) {
      return res
        .status(401)
        .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    const { userId, teamId } = req.body;
    if (!teamId || !userId) {
      return res.status(400).json({ message: "Missing required information" });
    }
    const targetUserId = Number(userId);
    if (!Number.isInteger(targetUserId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const response = await leaveTeam(teamId, targetUserId, session.userId);
    return res.status(response.status).json(response.json);
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
