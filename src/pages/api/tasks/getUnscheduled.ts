import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const { searchQuery } = req.query;
      const user = JSON.parse(req.cookies.nookies_user!);

      if (!user) {
        return res.status(200).json("Missing Required Data");
      }

      const projectIds = await fetchidlist(user.id);

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
                  userId: user.id as number,
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
                  userId: user.id as number,
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

export default handler;

const fetchidlist = async (id: number) => {
  try {
    if (id) {
      const projectid = await prisma.project.findMany({
        where: {
          OR: [
            {
              members: {
                some: {
                  userId: id,
                },
              },
            },
            {
              ownerId: {
                in: [id],
              },
            },
          ],
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
