import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { childId } = req.body;
      const currentUser = JSON.parse(req.cookies.nookies_user!)

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

export default handler;
