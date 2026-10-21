import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRequest, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

const route = taskWriteRoute({
  schema: z.custom<NonNullable<TaskWriteRequest["query"]>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  operation: async (query, session) => {
    const userId = session.userId;
    const { taskId } = query;
    if (!taskId) {
      return NextResponse.json({ message: "Missing Required Task ID" }, { status: 400, headers: privateHeaders });
    }

    const id = parseInt(taskId as string);
    if (Number.isNaN(id)) {
      return NextResponse.json({ message: "Invalid Task ID" }, { status: 400, headers: privateHeaders });
    }

    try {
      const task = await prisma.task.findFirst({
        where: {
          id,
          project: getProjectWhere(userId),
        },
        select: { userId: true, agentId: true },
      });

      if (!task) {
        return NextResponse.json({ message: "Task not found" }, { status: 404, headers: privateHeaders });
      }

      const [priority, estimate, labels, followersRaw] = await Promise.all([
        prisma.priority.findFirst({ where: { taskId: id } }),
        prisma.estimate.findFirst({ where: { taskId: id } }),
        prisma.taskLabel.findMany({
          where: { taskId: id },
          include: { label: true },
        }),
        prisma.follower.findMany({
          where: { taskId: id },
          select: {
            id: true,
            taskId: true,
            userId: true,
            agentId: true,
            mentionById: true,
            mentionAt: true,
          user: { select: { id: true, displayName: true, photoURL: true } },
          agent: { select: { id: true, displayName: true, photoURL: true } },
          },
        }),
      ]);

      let followers = followersRaw;
      if (task.agentId) {
        followers = followersRaw.filter((f) => f.agentId !== task.agentId);
      } else if (task.userId) {
        followers = followersRaw.filter((f) => f.userId !== task.userId);
      }

      return NextResponse.json({ priority, estimate, labels, followers }, { status: 200, headers: privateHeaders });
    } catch (error) {
      console.log(error);
      return NextResponse.json({ message: JSON.stringify(error) }, { status: 400, headers: privateHeaders });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  const response = await route({ headers: request.headers, json: async () => taskReadQuery(request) }, session);
  if (response) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }
  return response;
};
