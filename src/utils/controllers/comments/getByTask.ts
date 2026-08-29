import { IUser } from "@/models/model";
import { fetchCommentsForTask } from "@/utils/controllers/taskDetail/load";
import { getTaskReadStateLastReadAt } from "@/utils/controllers/tasks/markRead";
import { filterCommentReadReceipts } from "./readReceipts";

const commentsGetByTask = async (
  user: IUser,
  taskId: string | string[] | undefined
) => {
  try {
    const parsedTaskId = parseInt(taskId as string);
    const [comments, lastReadAt] = await Promise.all([
      fetchCommentsForTask(parsedTaskId, user.id),
      getTaskReadStateLastReadAt(parsedTaskId, user.id),
    ]);
    const filteredComments = await filterCommentReadReceipts(comments, user.id);
    return {
      status: 200,
      json: { comments: filteredComments, lastReadAt },
    };
  } catch (error) {
    console.log(error);
    return { status: 500, json: [] };
  }
};

export default commentsGetByTask;
