import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { normalizeDomain } from "@/lib/auth/emailDomain";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // Identity comes from the signed session only. Trusting a body userId here would
    // let anyone allowlist their own domain into someone else's paid team (HTPR-4182).
    const session = verifySession(req.cookies[SESSION_COOKIE]);
    if (!session) {
      return res
        .status(401)
        .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    const { teamId, domains } = req.body;

    if (!teamId || !Array.isArray(domains)) {
      return res.status(400).json({ message: "Missing Required Data!" });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { googleAccount: true },
    });

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (team.googleAccount.userId !== session.id) {
      return res
        .status(403)
        .json({ message: "Only the team owner can update allowed domains" });
    }

    const normalized: string[] = [];
    for (const raw of domains) {
      const result = normalizeDomain(raw);
      if (!result.ok) {
        return res.status(400).json({ message: result.reason });
      }
      normalized.push(result.domain);
    }

    await prisma.team.update({
      where: { id: teamId },
      data: { allowedEmailDomains: Array.from(new Set(normalized)) },
    });

    return res.status(200).json({ message: "success" });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: "error" });
  }
};

export default handler;
