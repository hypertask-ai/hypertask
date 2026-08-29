import type { NextApiHandler } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  const teamId = typeof req.body.teamId === "string" ? req.body.teamId : "";
  const updatedTitle =
    typeof req.body.updatedTitle === "string" ? req.body.updatedTitle.trim() : "";
  if (!teamId || !updatedTitle) {
    return res.status(400).json({ message: "Missing required data" });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { googleAccount: { select: { userId: true } } },
  });
  if (!team) return res.status(404).json({ message: "Team not found" });
  if (team.googleAccount.userId !== session.id) {
    return res.status(403).json({ message: "Only the team owner can rename it" });
  }

  await prisma.team.update({
    where: { id: teamId },
    data: { title: updatedTitle },
  });

  return res.status(200).json({ message: "success" });
};

export default handler;
