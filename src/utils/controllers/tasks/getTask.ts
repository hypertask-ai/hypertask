import { IUser } from "@/models/model";
import { fetchTaskDetail } from "@/utils/controllers/taskDetail/load";

const tasksGetTask = async (project: string, uniqueIndex: any, user: IUser) => {
  try {
    const task = await fetchTaskDetail(project, uniqueIndex, user.id);
    if (!task) throw "Task not found";
    return { status: 200, json: task };
  } catch (error) {
    console.log({ error });
    return { status: 500, json: null };
  }
};

/** @deprecated use fetchDescriptionReactions from taskDetail/load */
export { fetchDescriptionReactions as getReactionsByDescriptionId } from "@/utils/controllers/taskDetail/load";

export default tasksGetTask;
