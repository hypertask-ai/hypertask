// /api/tasks/move-task-to-different-board
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { moveTaskToDifferentBoard } from "@/utils/controllers/tasks/moveToDifferentBoard";
import { broadcastBoardChange } from "@/lib/realtime/server";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { id, projectId, sectionId, currentProjectId } = req.body;

    if (!id || !projectId || !sectionId || !currentProjectId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const currentUser = JSON.parse(req.cookies.nookies_user!);
    if (!currentUser?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await moveTaskToDifferentBoard({
      taskId: id,
      targetProjectId: projectId,
      targetSectionId: sectionId,
      currentProjectId,
      currentUser,
    });

    if (!result.success) {
      return res.status(result.statusCode ?? 500).json({
        message: result.error ?? "Failed to move task",
      });
    }

    Array.from(new Set([currentProjectId, projectId])).forEach((pid) =>
      void broadcastBoardChange(pid, { originUserId: currentUser.id })
    );

    return res.status(200).json(result.task);
  } catch (error) {
    console.error("Error moving task:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
