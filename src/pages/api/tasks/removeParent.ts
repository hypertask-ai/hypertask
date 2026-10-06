import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import type { IUser } from "@/models/model";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const currentUser = await loadSessionUserRecord(session.userId);
    try {
      const { childId } = req.body;

      if (!childId ) {
        return res.status(200).json("Missing Required Data");
      }

      const response = await updateTaskSingle({id: childId, parentTaskId: null}, currentUser)

      if (response.status === 200) {
        void broadcastBoardChange((response.json as any)?.projectId, { originUserId: currentUser.id });
      }

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/task-writes/remove-parent")).POST,
);
