import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { turbopufferGetSuggestions } from "@/utils/controllers/search/query";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    try {
      const { searchQuery } = req.body;

      if (!searchQuery || searchQuery.length === 0) {
        return res.status(200).json("Missing Required Data");
      }

      const projectRows = await prisma.project.findMany({
        where: {
          OR: [
            { members: { some: { userId: userId } } },
            { ownerId: { in: [userId] } },
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
