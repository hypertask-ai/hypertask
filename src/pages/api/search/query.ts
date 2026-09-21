import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { turbopufferGetSuggestions } from "@/utils/controllers/search/query";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const userObj = req.cookies?.nookies_user
        ? JSON.parse(req.cookies.nookies_user)
        : null;
      if (!userObj || !userObj.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { searchQuery } = req.body;

      if (!searchQuery || searchQuery.length === 0) {
        return res.status(200).json("Missing Required Data");
      }

      const projectRows = await prisma.project.findMany({
        where: {
          OR: [
            { members: { some: { userId: userObj.id } } },
            { ownerId: { in: [userObj.id] } },
          ],
        },
        select: { id: true },
      });
      const projectIds = projectRows.map((p: { id: number }) => p.id);

      if (projectIds.length === 0) {
        return res.status(200).json([]);
      }

      const results = await turbopufferGetSuggestions(searchQuery, projectIds);
      return res.status(200).json(results);
    } catch (error) {
      console.log("🤔 ~ handler ~ error:", error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
