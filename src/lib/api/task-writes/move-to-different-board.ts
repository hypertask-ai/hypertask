import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { moveTaskToDifferentBoard } from "@/utils/controllers/tasks/moveToDifferentBoard";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required fields",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    try {
      const { id, projectId, sectionId, currentProjectId } = body;

      if (!id || !projectId || !sectionId || !currentProjectId) {
        return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
      }

      const result = await moveTaskToDifferentBoard({
        taskId: id,
        targetProjectId: projectId,
        targetSectionId: sectionId,
        currentProjectId,
        currentUser,
      });

      if (!result.success) {
        return NextResponse.json({
          message: result.error ?? "Failed to move task",
        }, { status: result.statusCode ?? 500 });
      }

      Array.from(new Set([currentProjectId, projectId])).forEach((pid) =>
        void broadcastBoardChange(pid, { originUserId: currentUser.id })
      );

      return NextResponse.json(result.task, { status: 200 });
    } catch (error) {
      console.error("Error moving task:", error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
