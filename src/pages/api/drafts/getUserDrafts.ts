import prisma from "@/lib/prisma";
import type { NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = session.userId;

  try {
    const drafts = await prisma.drafts.findMany({
      where: {
        userId,
        type: "Comment",
        content: {
          notIn: ["", "<p></p>"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            projectId: true,
            uniqueIndex: true,
            ticketNumber: true,
            status: true,
            section: true,
            project: {
              select: {
                id: true,
                title: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return res
      .status(200)
      .json(drafts.filter((draft) => draft.task.status === "Normal"));
  } catch (error) {
    console.log(error);
    return res.status(500).json(error);
  }
}
