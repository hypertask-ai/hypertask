import prisma from "@/lib/prisma";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let userId: number;

  try {
    const userObj = JSON.parse(req.cookies?.nookies_user ?? "");
    userId = Number(userObj?.id);
    if (!Number.isFinite(userId)) throw new Error("Missing user id");
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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
