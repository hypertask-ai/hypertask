import { NextApiHandler } from "next";
import generateRank from "@/utils/generateRank";
import prisma from "@/lib/prisma";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import createTaskMovedActivity from "@/utils/controllers/activities/createTaskMovedActivity";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { toErrorMessage } from "@/lib/api/errorMessage";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "PUT")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const { taskId, section_title, sectionId, ranking, projectId, agentId } = req.body;
    const userObj = req.cookies.nookies_user && JSON.parse(req.cookies.nookies_user);

    // Validate required fields up front
    if (!taskId || !section_title || !sectionId || !userObj || !projectId) {
      return res.status(400).json({ message: "Missing Required Information" });
    }

    const [taskToMove, targetSection] = await Promise.all([
      prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } }),
      prisma.section.findFirst({ where: { id: sectionId, projectId }, select: { id: true } }),
    ]);
    if (!taskToMove || taskToMove.projectId !== projectId || !targetSection) {
      return res.status(400).json({ message: "Invalid task or section" });
    }

    // Fetch agent if present
    const agent = agentId
      ? await prisma.agent.findUnique({
          where: { id: agentId, revokedAt: null },
          select: { id: true, userId: true, displayName: true, photoURL: true },
        })
      : null;

    let ranking_ = ranking;
    if (!ranking_) {
      // If no rank provided, generate one (add at end)
      const task = await prisma.task.findFirst({
        where: { sectionId, status: "Normal" },
        orderBy: { ranking: "desc" },
      });
      ranking_ = generateRank(task?.ranking, undefined);
    }

    // Build the update payload
    const updatedTaskData = {
      id: taskId,
      sectionId,
      section: section_title,
      ranking: ranking_,
      updatedAt: new Date(),
    };

    const response: any = await updateTaskSingle(
      updatedTaskData,
      userObj,
      agentId ?? null
    );

    if (response.status !== 200) {
      // Keep the controller's own status (404 unauthorised, 409 agent lease)
      // and normalise the payload to a string: an object in this slot reaches
      // the CLI as "[object Object]" and hides the real reason.
      return res
        .status(response.status)
        .json({ message: toErrorMessage(response.json, "Failed to move task") });
    }

    // Real-time: refresh this board for everyone watching it.
    void broadcastBoardChange(projectId, { originUserId: userObj.id });
    // HTPR-4484: sync the moved task into any open task-detail view (section change).
    void broadcastTaskChange(taskId, { originUserId: userObj.id });

    const moveActivity = await createTaskMovedActivity({
      taskId,
      toSection_title: section_title,
      toSectionId: sectionId,
      userObj,
      fromSection_title: response.oldTask?.section ?? "",
      fromSectionId: response.oldTask?.sectionId,
      fromAgent: agent,
      sendNotification: () =>
        sendNotificationForTask(
          userObj.id,
          "TaskMoved",
          taskId,
          projectId,
          agentId ?? null,
        ),
    });

    // Send back updated task, optionally with new activity
    return res.status(response.status).json({
      ...response.json,
      ...(moveActivity.newComment && { newComment: moveActivity.newComment }),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
