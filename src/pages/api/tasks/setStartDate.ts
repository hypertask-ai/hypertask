import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler } from "next";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import type { IUser } from "@/models/model";

// HTPR-4884: set/clear a task's planned start date. Mirrors setDueDate.ts but
// deliberately lighter: no queue job and no notification fire off a start date.
const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userObj = await loadSessionUserRecord(session.userId);

  try {
    const { taskId, startDate } = req.body;
    if (!taskId) {
      return res.status(400).json({ message: "Missing required field" });
    }

    // updateTaskSingle writes by id without checking membership, so gate here.
    // No agentId: it would come from the request body, and the agent branch of
    // getProjectWhere checks board membership of that agent, not that the
    // caller owns it — a body-supplied id would be a cross-account write.
    if (!(await userCanAccessTask(userObj.id, Number(taskId)))) {
      return res.status(404).json({ message: "Task not found" });
    }

    const { status, json: task }: any = await updateTaskSingle(
      { id: taskId, startDate: startDate ? new Date(startDate) : null },
      userObj,
      null
    );

    if (status === 200) {
      void broadcastBoardChange(task?.projectId, { originUserId: userObj.id });
      // HTPR-6281: the open task detail view listens only on the task channel.
      void broadcastTaskChange(task?.id ?? Number(taskId), {
        originUserId: userObj.id,
      });
    }

    return res.status(status).json(task);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: String(error) });
  }
};

export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/task-writes/start-date")).POST,
);
