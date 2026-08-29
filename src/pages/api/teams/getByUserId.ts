import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(300).json({ message: "Missing Required Data!" });
    }

    const team = await prisma.team.findFirst({
      where: {
        googleAccount: {
          userId: parseInt(userId as string),
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
