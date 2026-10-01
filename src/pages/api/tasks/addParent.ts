import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import AddParentTask from "@/utils/controllers/tasks/addParent";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
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
    const currentUser = { id: session.userId } as IUser;
    try {
      const { orphanId, parentId } = req.body;

      if (!orphanId || !parentId) {
        return res.status(200).json("Missing Required Data");
      }

      const response = await updateTaskSingle({id: orphanId, parentTaskId: parentId}, currentUser)

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

export default handler;
