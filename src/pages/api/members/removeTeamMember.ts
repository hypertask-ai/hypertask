import { leaveTeam } from "@/utils/controllers/teams/leave";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = verifySession(req.cookies[SESSION_COOKIE]);
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

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { googleAccount: { select: { userId: true } } },
    });
    if (!team) return res.status(404).json({ message: "Team not found" });
    const isOwner = team.googleAccount.userId === session.id;
    const isLeavingSelf = targetUserId === session.id;
    if (!isOwner && !isLeavingSelf) {
      return res
        .status(403)
        .json({ message: "Only the team owner can remove members" });
    }

    const response = await leaveTeam(teamId, targetUserId);
    return res.status(response.status).json(response.json);
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
