import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing TaskId",
  allowNullBody: true,
  prepare: session => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    const { taskIds, agentId } = req.body;
    console.log("🚀 ~ file: resetRanks.ts:14 ~ consthandler:NextApiHandler= ~ taskIds:", taskIds);
    if (!taskIds) {
      return NextResponse.json({ message: "Missing TaskId" }, { status: 400 });
    }
    try {
      let currentRank = 100;
      const uniqueTaskIds = Array.from(new Set(taskIds)) as number[];
      const projectIds = await prisma.task.findMany({
        where: {
          id: { in: uniqueTaskIds },
          project: taskWriteAccessWhere(currentUser.id, agentId),
        },
        select: { projectId: true },
      });
      if (projectIds.length !== uniqueTaskIds.length) {
        return NextResponse.json({ message: "Task not found or access denied" }, { status: 404 });
      }
      for (const task of taskIds) {
        try {
          await prisma.task.update({
            where: { id: task },
            data: { ranking: `A${currentRank.toString().padStart(4, "0")}` },
          });
        } catch (error) {
          if ((error as { code?: string })?.code !== "P2025") throw error;
        }
        currentRank += 30;
      }
      Array.from(new Set(projectIds.map((task) => task.projectId))).forEach((projectId) =>
        void broadcastBoardChange(projectId)
      );
      return NextResponse.json({ message: "success" }, { status: 200 });
    } catch (error) {
      console.error("Error:", error);
      return NextResponse.json({ message: "SOMETHING WENT WRONG" }, { status: 500 });
    }
  },
});
