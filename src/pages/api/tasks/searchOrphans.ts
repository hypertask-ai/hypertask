import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import SearchForOrphanTasks from "@/utils/controllers/tasks/getOrphanTasks";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const { projectId, searchQuery, currentTaskId } = req.query;

      if (!projectId || !currentTaskId) {
        return res.status(200).json("Missing Required Data");
      }

      const response = await SearchForOrphanTasks(
        parseInt(projectId as string),
        parseInt(currentTaskId as string),
        searchQuery as string
      );

      return res.status(response.status).json(response);
    } catch (error) {
      htLogger.info("🚀 ~ error:", error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default withAuth(handler);
