import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const { shareId } = req.query;
    try {
      const taskShared = await prisma.taskSharing.findUnique({
        where: {
          id: shareId as string,
        },
        include: {
          task: true,
        },
      });

      if (taskShared)
        return res.status(200).json({
          taskShared,
        });
      else return res.status(400).json({});
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export const generateShareLink = (shareId: string) => {
  const baseURL = String(process.env.NEXT_PUBLIC_BASEURL);
  return `${baseURL}/share?id=${shareId}`;
};

export default handler;
