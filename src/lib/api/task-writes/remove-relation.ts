import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { removeRelatedTask } from "@/utils/controllers/tasks/removeRelatedTask";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    try {
      const { relationId } = req.body;
      if (!relationId) {
        return NextResponse.json("Missing Required Data", { status: 200 });
      }

      const relation = await prisma.taskRelations.findFirst({
        where: {
          id: Number(relationId),
          sourceTask: { project: getProjectWhere(session.userId) },
          targetTask: { project: getProjectWhere(session.userId) },
        },
        select: {
          sourceTask: { select: { projectId: true } },
          targetTask: { select: { projectId: true } },
        },
      });
      if (!relation) {
        return NextResponse.json({ message: "Relation not found" }, { status: 404 });
      }

      const response = await removeRelatedTask(relationId);

      if (response.status === 200) {
        Array.from(new Set([
          relation?.sourceTask.projectId,
          relation?.targetTask.projectId,
        ])).forEach((projectId) => void broadcastBoardChange(projectId));
      }

      return NextResponse.json(response, { status: response.status });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return new NextResponse(null, { status: 200 });
    }
  },
});
