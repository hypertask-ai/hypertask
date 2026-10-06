import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRequest, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import prisma from "@/lib/prisma";

const route = taskWriteRoute({
  schema: z.custom<NonNullable<TaskWriteRequest["query"]>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  operation: async (query, session) => {
    const userId = session.userId;
    try {
      const { searchQuery } = query;

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

      return NextResponse.json(tasks, { status: 200 });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return NextResponse.json([], { status: 200 });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  return route({ headers: request.headers, json: async () => taskReadQuery(request) }, session);
};

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
