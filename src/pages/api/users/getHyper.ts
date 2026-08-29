import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const hyperAiId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332");

      const user = await prisma.user.findFirst({
        where: {
          id: hyperAiId,
        },
      });

      if (!user) {
        return res
          .status(400)
          .json({ message: "Unable to find HyperAI from DB" });
      }

      return res.status(200).json(user);
    } catch (error) {
      console.log(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
