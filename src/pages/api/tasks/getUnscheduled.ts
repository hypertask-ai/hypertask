import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    try {
      const { searchQuery } = req.query;

      const projectIds = await fetchidlist(userId);

      const tasks = searchQuery
        ? await prisma.task.findMany({
            take: 10,
            where: {
              deletedAt: null,
              dueDate: null,
              projectId: {
                in: projectIds,
              },
              OR: [
                {
                  title: {
                    contains: searchQuery as string,
                    mode: "insensitive",
                  },
                },
                {
                  ticketNumber: {
                    contains: searchQuery as string,
                    mode: "insensitive",
                  },
                },
              ],
            },
            include: {
              project: {
                select: {
                  id: true,
                  title: true,
                },
              },
              savedContent: {
                where: {
                  userId: userId,
                  commentId: null
                }
              }, 
            },
            orderBy: {
              createdAt: "desc",
            },
          })
        : await prisma.task.findMany({
            take: 10,
            where: {
              deletedAt: null,
              dueDate: null,
              projectId: {
                in: projectIds,
              },
            },
            include: {
              project: {
                select: {
                  id: true,
                  title: true,
                },
              },
              savedContent: {
                where: {
                  userId: userId,
                  commentId: null
                }
              },
            },
            orderBy: {
              updatedAt: "desc",
            },
          });

      return res.status(200).json(tasks);
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default withTaskWriteFlag(handler, "GET", async () =>
  (await import("@/lib/api/task-writes/unscheduled-read")).GET,
);

const fetchidlist = async (id: number) => {
  try {
    if (id) {
      const projectid = await prisma.project.findMany({
        where: {
          ...projectContentAccessWhere(id),
        },
        select: {
          id: true,
        },
      });
      const valuesArray = projectid.map((obj: any) => Object.values(obj));
      return valuesArray.flat() as number[];
    }
    return [];
  } catch (error) {
    console.log("🤔 ~ fetchidlist ~ error:", error);
    return [];
  }
};
