import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import type { NextApiHandler } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  logDesktopCliResponse(session, req, res);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : "";
  if (!teamId) {
    return res.status(400).json({ message: "teamId required" });
  }

  if (!(await hasTeamMembershipAccess(session.userId, teamId))) {
    return res.status(403).json({ message: "Team access denied" });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      googleAccount: true,
      subscriptionPlan: {
        where: { subscriptionStatus: { not: "Expired" } },
      },
    },
  });

  if (!team) return res.status(404).json({ message: "Team not found" });
  return res.status(200).json(team);
};

export default handler;
