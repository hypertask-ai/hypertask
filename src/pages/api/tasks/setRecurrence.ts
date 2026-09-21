import { NextApiHandler } from "next";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { isRecurrenceRule } from "@/lib/recurrence";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";

// HTPR-4885: set/clear a task's repeat rule. The rule sits on the task until
// it is completed; spawnRecurrence.ts then moves it to the next occurrence.
const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { taskId, recurrence } = req.body;
    const userObj =
      req.cookies?.nookies_user && JSON.parse(req.cookies.nookies_user);
    if (!taskId || !userObj) {
      return res.status(400).json({ message: "Missing required field" });
    }
    if (recurrence != null && !isRecurrenceRule(recurrence)) {
      return res.status(400).json({ message: "Invalid recurrence rule" });
    }

    // updateTaskSingle writes by id without checking membership, so gate here.
    // No agentId: it would come from the request body, and the agent branch of
    // getProjectWhere checks board membership of that agent, not that the
    // caller owns it — a body-supplied id would be a cross-account write.
    if (!(await userCanAccessTask(userObj.id, Number(taskId)))) {
      return res.status(404).json({ message: "Task not found" });
    }

    const { status, json: task }: any = await updateTaskSingle(
      { id: taskId, recurrence: recurrence ?? null },
      userObj,
      null
    );

    if (status === 200) {
      void broadcastBoardChange(task?.projectId, { originUserId: userObj.id });
    }

    return res.status(status).json(task);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: String(error) });
  }
};

export default handler;
