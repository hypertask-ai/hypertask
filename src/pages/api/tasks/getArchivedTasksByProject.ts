import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetArchivedTasksByProject from "@/utils/controllers/tasks/getArchivedTasksByProject";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    try {
      const { projectId } = req.query;

      if (!projectId) {
        return res.status(400).json({ message: "Missing required field" });
      }

      const response = await tasksGetArchivedTasksByProject(projectId, userId);
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(400).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
