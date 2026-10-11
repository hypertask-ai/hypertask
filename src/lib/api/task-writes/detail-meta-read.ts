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
      // Resolved first, and scoped to projects this user is in: everything below
      // is only fetched once the caller is known to be able to see the task.
      // Also supplies the creator ids the follower filter needs.
      const task = await prisma.task.findFirst({
        where: {
          id,
          // Membership only, no project status filter. Archived boards are a real
          // surface: /archived lists their tasks and opening one mounts the normal
          // task detail, so filtering on status here 404s the fields for an owner
          // who can legitimately see the task. Sibling routes (tasks/waiting-on,
          // assignees/assign) scope the same way.
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
          // The follower list renders as an avatar plus a name (AssigneeCard in
          // MainPageComponents/index.tsx reads photoURL and displayName, nothing
          // else), so that is all this returns. It used to send whole User rows,
          // email included, which made an unauthenticated request keyed on an
          // autoincrement task id an enumerable address book (HTPR-3708).
          user: { select: { id: true, displayName: true, photoURL: true } },
          agent: { select: { id: true, displayName: true, photoURL: true } },
          },
        }),
      ]);

      // Same rule as /api/follower/getFollower: the task's own creator is not
      // listed as a follower of it, whether that creator is a user or an agent.
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
