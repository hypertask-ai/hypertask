// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // ================== get request body
  const { projectId } = req.query;
  if (!projectId)
    return res.status(400).json({ message: "Missing Required Information" });

  // ================== find all labels associated with that projectId

  const labels = await prisma.label.findMany({
    where: {
      projectId: parseInt(projectId as string),
    },
    include: {
      task: {
        include: {
          task: {
            select: {
              id: true,
              projectId: true,
              title: true,
              uniqueIndex: true,
              ticketNumber: true,
              userId: true,
              status: true,
            },
          },
        },
        orderBy: {
          id: "desc",
        },
      },
      _count: {
        select: {
          task: {
            where: {
              task: {
                status: "Normal",
              },
            },
          },
        },
      },
    },
    orderBy:{
      value:"asc"
    }
  });
  return res.status(200).json(labels.map((label) => ({
    ...label,
    _count: {
      ...label._count,
      archived: label.task.filter(({ task }) => task.status === "Archive").length,
    },
  })));
}
