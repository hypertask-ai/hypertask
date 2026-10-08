import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { listTaskAgentRunActivities } from "@/lib/agentRuns/service";
import { fetchCommentsForTask } from "@/utils/controllers/taskDetail/load";
import { getTaskReadStateLastReadAt } from "@/utils/controllers/tasks/markRead";
import { filterCommentReadReceipts } from "./readReceipts";

const commentsGetByTask = async (
  userId: number,
  taskId: string | string[] | undefined
) => {
  try {
    const parsedTaskId = parseInt(taskId as string);
    const task = await prisma.task.findFirst({
      where: { id: parsedTaskId, project: projectContentAccessWhere(userId) },
      select: { id: true },
    });
    if (!task) return { status: 404, json: { message: "Task not found" } };

    const [comments, lastReadAt, agentRunActivities] = await Promise.all([
      fetchCommentsForTask(parsedTaskId, userId),
      getTaskReadStateLastReadAt(parsedTaskId, userId),
      listTaskAgentRunActivities(userId, parsedTaskId).catch((error) => {
        console.error("[agent-run] task activity load failed", error);
        return [];
      }),
    ]);
    const filteredComments = await filterCommentReadReceipts(comments, userId);
    return {
      status: 200,
      json: { comments: filteredComments, lastReadAt, agentRunActivities },
    };
  } catch (error) {
    console.log(error);
    return { status: 500, json: [] };
  }
};

export default commentsGetByTask;
