import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });
      const { setting, userId: bodyUserId } = req.body;
      if (bodyUserId != null && Number(bodyUserId) !== session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const response = await prisma.userSetting.update({
        where: {
          userId: session.userId,
        },
        data: {
          onboardingTourStatus: setting,
        },
      });
      return res.status(200).json(response);
    } catch (error) {
      console.log(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
