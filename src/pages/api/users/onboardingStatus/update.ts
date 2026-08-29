import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { setting, userId } = req.body;
      if (!userId)
        return res.status(401).json({ message: "Missing fields" });

      const response = await prisma.userSetting.update({
        where: {
          userId: parseInt(userId as string),
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
