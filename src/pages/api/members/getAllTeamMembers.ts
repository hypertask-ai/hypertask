import type { NextApiHandler } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : "";
  if (!teamId) {
    return res.status(400).json({ message: "teamId required" });
  }

  if (!(await hasTeamMembershipAccess(session.id, teamId))) {
    return res.status(403).json({ message: "Team access denied" });
  }

  const [team, teamMembers] = await Promise.all([
    prisma.team.findUnique({
      where: { id: teamId },
      select: { googleAccount: { select: { userId: true } } },
    }),
    prisma.member_Team.findMany({
      where: { teamId, status: "Accepted" },
      select: { user: true },
    }),
  ]);

  if (!team) return res.status(404).json({ message: "Team not found" });

  const owner = await prisma.user.findUnique({
    where: { id: team.googleAccount.userId },
  });

  return res.status(200).json({
    owner,
    members: teamMembers.map(({ user }) => user),
  });
};

export default handler;
