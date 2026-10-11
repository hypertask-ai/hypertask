import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import {
  addRelatedTasks,
  isTaskRelationType,
} from "@/utils/controllers/tasks/addRelatedTasks";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const userId = session.userId;
    try {
      const { relations } = req.body;
      if (!relations) {
        return NextResponse.json("Missing Required Data", { status: 200 });
      }
      const invalidRelationType = relations.relatedTasks?.some(
        (related: any) =>
          related.relationType !== undefined &&
          !isTaskRelationType(related.relationType)
      );
      if (invalidRelationType) {
        return NextResponse.json({ message: "Invalid relation type" }, { status: 400 });
      }

      const response = await addRelatedTasks(relations, userId);

      if (response.status === 200) {
        const currentTask = await prisma.task.findUnique({
          where: { id: parseInt(relations.currentTaskId) },
          select: { projectId: true },
        });
        const projectIds = new Set<number>();
        if (currentTask) projectIds.add(currentTask.projectId);
        (response.json as any[])?.forEach((relation) => {
          if (relation.targetTask?.projectId) projectIds.add(relation.targetTask.projectId);
        });
        projectIds.forEach((projectId) => void broadcastBoardChange(projectId));
      }

      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return new NextResponse(null, { status: 200 });
    }
  },
});
