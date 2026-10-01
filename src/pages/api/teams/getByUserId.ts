import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const team = await prisma.team.findFirst({
      where: {
        googleAccount: {
          userId: session.userId,
        },
      },
      include: {
        projects: true,
        members: true,
        googleAccount: true,
        team_activity: true,
      },
    });

    return res.status(200).json(team);
  } catch (error) {
    console.log(error);
    return {
      status: 400,
      json: [],
    };
  }
};

export default handler;
